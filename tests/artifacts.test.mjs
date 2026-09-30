import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const processCwd = process.cwd();
const piDir = process.env.PI_TEST_CODING_AGENT_DIR
  ? resolve(process.env.PI_TEST_CODING_AGENT_DIR)
  : dirname(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))));
const { loadExtensions } = await import(pathToFileURL(join(piDir, "dist/core/extensions/loader.js")));
const hostRequire = createRequire(join(piDir, "package.json"));
const { createJiti } = hostRequire("jiti");
const jiti = createJiti(import.meta.url, { moduleCache: false });
const server = await jiti.import(join(root, "agent/extensions/artifacts/server.ts"));
const utils = await jiti.import(join(root, "agent/extensions/artifacts/utils.ts"));
const templates = await jiti.import(join(root, "agent/extensions/artifacts/templates.ts"));
let fixture, a, b, extension, tool;
let listeners = [];
const originalListen = http.Server.prototype.listen;

before(async () => {
  fixture = await mkdtemp(join(tmpdir(), "pikit-artifacts-"));
  a = join(fixture, "project-a");
  b = join(fixture, "project-b");
  await Promise.all([mkdir(a), mkdir(b)]);
  const loaded = await loadExtensions([join(root, "agent/extensions/artifacts/index.ts")], root);
  assert.deepEqual(loaded.errors, []);
  extension = loaded.extensions[0];
  tool = extension.tools.get("artifact").definition;
});
beforeEach(() => {
  listeners = [];
  // Track actual listeners so red tests cannot leave the known duplicate alive.
  http.Server.prototype.listen = function (...args) {
    listeners.push(this);
    return originalListen.apply(this, args);
  };
});
afterEach(async () => {
  http.Server.prototype.listen = originalListen;
  await server.stopServer();
  await shutdownExtension();
  await Promise.all(listeners.map(close));
});
after(async () => { await rm(fixture, { recursive: true, force: true }); });

async function shutdownExtension() {
  for (const handler of extension.handlers.get("session_shutdown") ?? []) {
    await handler({ type: "session_shutdown" }, { cwd: a });
  }
}
function close(instance) {
  instance.closeAllConnections();
  return new Promise((done) => instance.close(() => done()));
}
function get(url) {
  return new Promise((done, reject) => {
    http.get(url, { agent: false }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => done({ status: res.statusCode, body }));
    }).on("error", reject);
  });
}
function url(port, path = "/") { return `http://127.0.0.1:${port}${path}`; }
function execute(cwd, params) { return tool.execute("artifact-test", params, undefined, undefined, { cwd }); }
function text(result) { return result.content.map((block) => block.text ?? "").join("\n"); }

// Missing shared startup would produce different ports and leave one reachable.
test("concurrent startup shares one listener, and shutdown closes it", async () => {
  const ports = await Promise.all(Array.from({ length: 12 }, () => server.ensureServer(a)));
  assert.equal(new Set(ports).size, 1);
  assert.equal(listeners.length, 1);
  assert.equal((await get(url(ports[0]))).status, 200);
  await server.stopServer();
  assert.equal(server.runningPort(a), null);
  await assert.rejects(get(url(ports[0])));
});

// Delaying the real listen call makes the startup/shutdown overlap deterministic.
test("stop during startup cancels old startup without resurrecting state or leaking", async () => {
  let release;
  http.Server.prototype.listen = function (...args) {
    listeners.push(this);
    release = () => originalListen.apply(this, args);
    return this;
  };
  const pending = server.ensureServer(a);
  const outcome = pending.then((port) => ({ port }), (error) => ({ error }));
  const stopped = server.stopServer();
  const again = server.stopServer();
  release();
  const result = await outcome;
  await Promise.all([stopped, again]);
  assert.ok(result.error, "startup interrupted by shutdown must reject");
  assert.equal(server.isRunning(a), false);
  assert.equal(server.runningPort(a), null);
  assert.equal(listeners[0].listening, false);
  http.Server.prototype.listen = function (...args) {
    listeners.push(this);
    return originalListen.apply(this, args);
  };
  const port = await server.ensureServer(a);
  assert.equal((await get(url(port))).status, 200);
});

test("an old cancelled startup cannot overwrite a newer running server", async () => {
  let release;
  http.Server.prototype.listen = function (...args) {
    listeners.push(this);
    release = () => originalListen.apply(this, args);
    return this;
  };
  const old = server.ensureServer(a).then(() => false, () => true);
  const stopped = server.stopServer();
  http.Server.prototype.listen = function (...args) {
    listeners.push(this);
    return originalListen.apply(this, args);
  };
  const fresh = await server.ensureServer(a);
  release();
  assert.equal(await old, true);
  await stopped;
  assert.equal(server.runningPort(a), fresh);
  assert.equal((await get(url(fresh))).status, 200);
});

test("startup failure allows retry and normal restart", async () => {
  // The OS error is injected at the listen boundary; subsequent attempts use real HTTP.
  http.Server.prototype.listen = function () {
    listeners.push(this);
    queueMicrotask(() => this.emit("error", new Error("listen failed")));
    return this;
  };
  await assert.rejects(server.ensureServer(a), /listen failed/);
  assert.equal(server.isRunning(a), false);
  http.Server.prototype.listen = function (...args) {
    listeners.push(this);
    return originalListen.apply(this, args);
  };
  const first = await server.ensureServer(a);
  assert.equal((await get(url(first))).status, 200);
  await server.stopServer();
  await assert.rejects(get(url(first)));
  const next = await server.ensureServer(a);
  assert.equal(server.runningPort(a), next);
  assert.equal((await get(url(next))).status, 200);
});

test("concurrent roots serve their own same-slug files and index metadata", async () => {
  await Promise.all([a, b].map((cwd) => mkdir(join(cwd, ".pi/artifacts"), { recursive: true })));
  await writeFile(join(a, ".pi/artifacts/shared.html"), "<title>A only</title>root A");
  await writeFile(join(b, ".pi/artifacts/shared.html"), "<title>B only</title>root B");
  const [ua, ub] = await Promise.all([server.artifactUrl("shared", a), server.artifactUrl("shared", b)]);
  assert.notEqual(ua, ub);
  assert.equal((await get(ua)).body, "<title>A only</title>root A");
  assert.equal((await get(ub)).body, "<title>B only</title>root B");
  const ia = (await get(await server.artifactUrl(undefined, a))).body;
  assert.ok(ia.includes(a));
  assert.ok(ia.includes("A only"));
  assert.ok(!ia.includes("B only"));
  const ib = (await get(await server.artifactUrl(undefined, b))).body;
  assert.ok(ib.includes(b));
  assert.ok(ib.includes("B only"));
  await server.stopServer();
  await Promise.all([assert.rejects(get(ua)), assert.rejects(get(ub))]);
});

test("reload events are scoped to their root and shutdown ends SSE clients", async () => {
  const [pa, pb] = await Promise.all([server.ensureServer(a), server.ensureServer(b)]);
  const streams = await Promise.all([pa, pb].map((port) => new Promise((done, reject) => {
    const req = http.get(url(port, "/events"), { agent: false }, (res) => {
      const stream = { req, res, data: "" };
      res.setEncoding("utf8");
      res.on("data", (chunk) => { stream.data += chunk; });
      res.once("data", () => done(stream));
    }).on("error", reject);
  })));
  const [sa, sb] = streams;
  try {
    const received = Promise.race(streams.map(({ res }) => new Promise((done) => res.once("data", done))));
    server.notifyReload("shared", a);
    await received;
    assert.match(sa.data, /event: reload\ndata: shared/);
    // Complete a real request on B as a barrier rather than sleeping.
    await get(url(pb));
    assert.doesNotMatch(sb.data, /event: reload/);
    const ended = streams.map(({ res }) => new Promise((done) => res.once("end", done)));
    await server.stopServer();
    await Promise.all(ended);
  } finally {
    for (const { req } of streams) req.destroy();
  }
});

test("utilities use explicit roots and backward default calls still use process CWD", () => {
  assert.equal(utils.artifactDir(a), join(a, ".pi/artifacts"));
  assert.equal(utils.artifactDir(), join(process.cwd(), ".pi/artifacts"));
  utils.writeArtifact("utility", "<title>Utility</title>", a);
  assert.equal(utils.readArtifact("utility", a), "<title>Utility</title>");
  assert.equal(utils.artifactExists("utility", a), true);
  assert.equal(utils.artifactExists("utility", b), false);
  assert.equal(utils.safeArtifactPath("/utility.html", a), join(a, ".pi/artifacts/utility.html"));
  assert.equal(utils.safeArtifactPath("/../../outside.html", a), null);
});

for (const [kind, source] of [
  ["markdown", "# Session input"],
  ["html", "<p>Session input</p>"],
  ["html", "<!DOCTYPE html><html><head><title>Full</title></head><body>Session input</body></html>"],
]) {
  test(`create reads session-relative ${kind} input and embeds session project metadata (${source.slice(0, 15)})`, async () => {
    const title = `Session ${kind} ${source.startsWith("<!") ? "full" : "fragment"}`;
    const slug = title.toLowerCase().replaceAll(" ", "-");
    await writeFile(join(a, "input.txt"), source);
    const result = await execute(a, { action: "create", title, kind, path: "input.txt", open: false });
    assert.equal(result.isError, undefined, text(result));
    assert.equal(result.details.absPath, join(a, `.pi/artifacts/${slug}.html`));
    const html = await readFile(result.details.absPath, "utf8");
    assert.ok(html.includes("Session input"));
    assert.ok(html.includes(`<meta name="artifact-project" content="${a}">`));
    assert.equal(process.cwd(), processCwd, "extension must not change global cwd");
    const listed = await execute(a, { action: "list" });
    assert.ok(text(listed).includes(result.details.absPath));
    assert.ok(!text(await execute(b, { action: "list" })).includes(result.details.absPath));
  });
}

test("create and update accept absolute file input without prefixing session CWD", async () => {
  const input = join(b, "absolute.txt");
  await writeFile(input, "absolute input");
  for (const action of ["create", "update"]) {
    const result = await execute(a, { action, title: "Absolute input", kind: "markdown", path: input, open: false });
    assert.equal(result.isError, undefined, text(result));
    assert.ok((await readFile(join(a, ".pi/artifacts/absolute-input.html"), "utf8")).includes("absolute input"));
  }
});

test("template default project metadata remains backward compatible", () => {
  const html = templates.renderMarkdownDocument("Default", "default", "body");
  assert.ok(html.includes(`<meta name="artifact-project" content="${process.cwd()}">`));
});

test("command opens session index and tool URLs, list, updates, open stay root-scoped", async (t) => {
  const opened = [];
  t.mock.method(childProcess, "spawn", (_cmd, args) => {
    opened.push(args.at(-1));
    return Object.assign(new EventEmitter(), { unref() {} });
  });
  syncBuiltinESMExports();
  try {
    const command = extension.commands.get("artifacts");
    await Promise.all([a, b].map((cwd) => command.handler("", { cwd, hasUI: false })));
    const [ua, ub] = opened;
    assert.notEqual(ua, ub);
    assert.ok((await get(ua)).body.includes(a));
    assert.ok((await get(ub)).body.includes(b));
    const [ra, rb] = await Promise.all([a, b].map((cwd) => execute(cwd, {
      action: "create", title: "Tool scoped", kind: "html", content: `<p>${cwd}</p>`, open: false,
    })));
    assert.notEqual(ra.details.url, rb.details.url);
    assert.ok((await get(ra.details.url)).body.includes(a));
    assert.ok((await get(rb.details.url)).body.includes(b));
    assert.ok(text(await execute(a, { action: "list" })).includes(ra.details.url));
    assert.ok(!text(await execute(a, { action: "list" })).includes(rb.details.url));
    const updated = await execute(a, { action: "update", title: "Tool scoped", kind: "html", content: "updated", open: false });
    assert.equal(updated.details.url, ra.details.url);
    assert.ok((await get(updated.details.url)).body.includes("updated"));
    const openedResult = await execute(b, { action: "open", title: "Tool scoped" });
    assert.equal(openedResult.details.url, rb.details.url);
    await shutdownExtension();
    await Promise.all([assert.rejects(get(ua)), assert.rejects(get(ub))]);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});
