import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const piDir = process.env.PI_TEST_CODING_AGENT_DIR
  ? resolve(process.env.PI_TEST_CODING_AGENT_DIR)
  : dirname(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))));
const { loadExtensions } = await import(pathToFileURL(join(piDir, "dist/core/extensions/loader.js")));
const extensionPath = fileURLToPath(new URL("../agent/extensions/startup/index.ts", import.meta.url));
const commands = [
  { source: "skill", name: "review" }, { source: "skill", name: "review" },
  { source: "skill", name: "debug" }, { source: "prompt", name: "daily" },
  { source: "extension", name: "not-a-skill" },
];

async function fixture(t, { scope = [], available = [{ id: "one" }, { id: "two" }, { id: "three" }], registry = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), "pikit-startup-"));
  const oldHome = process.env.HOME;
  process.env.HOME = root;
  t.after(async () => {
    if (oldHome === undefined) delete process.env.HOME;
    else process.env.HOME = oldHome;
    await rm(root, { recursive: true, force: true });
  });
  const loaded = await loadExtensions([extensionPath], root);
  assert.deepEqual(loaded.errors, []);
  loaded.runtime.getCommands = () => commands;
  let header;
  const ctx = { cwd: root, hasUI: true, scopedModels: scope,
    modelRegistry: registry ? { getAvailable: () => available, getAll: () => Array(100).fill({ id: "unavailable" }) } : {},
    isProjectTrusted: () => false,
    ui: { setHeader: (factory) => { header = factory({}, { fg: (_name, text) => text }); } },
  };
  const save = async (path, value) => {
    const fullPath = join(root, path);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, value);
  };
  return { root, ctx, save,
    start: async () => {
      for (const handler of loaded.extensions[0].handlers.get("session_start")) {
        await handler({ type: "session_start", reason: "startup" }, ctx);
      }
    },
    render: (width = 120) => header.render(width).map((line) => line.replace(/\x1b\[[0-9;]*m/g, "")),
  };
}

// Counting enabledModels globs or using the full unauthenticated catalog breaks these counts.
test("startup counts resolved runtime scope instead of configured model patterns", async (t) => {
  const f = await fixture(t, { scope: [{ model: { provider: "router", id: "auto" }, thinkingLevel: "high" },
    { model: { provider: "openai", id: "physical" }, thinkingLevel: "low" }] });
  await f.save(".pi/agent/settings.json", JSON.stringify({ enabledModels: ["openai/*", "router/*", "not-found", "other/*"] }));
  await f.start();
  assert.match(f.render().join("\n"), /2 scoped models/);
  assert.doesNotMatch(f.render().join("\n"), /4 models|100 models/);
});

test("empty scope counts available registry models, not all catalog models", async (t) => {
  const f = await fixture(t);
  await f.start();
  assert.match(f.render().join("\n"), /3 available models/);
});

test("missing registry support omits model count instead of counting globs", async (t) => {
  const f = await fixture(t, { registry: false });
  await f.save(".pi/agent/settings.json", JSON.stringify({ enabledModels: ["*"] }));
  await f.start();
  assert.doesNotMatch(f.render().join("\n"), /\d+ (?:scoped |available )?models?/);
});

test("zero available models is an accurate runtime count", async (t) => {
  const f = await fixture(t, { available: [] });
  await f.start();
  assert.match(f.render().join("\n"), /0 available models/);
});

test("filesystem candidates are configured estimates even when project trust prevents loading", async (t) => {
  const f = await fixture(t);
  await f.save(".pi/extensions/candidate.ts", "export default function () {}\n");
  await f.save("AGENTS.md", "project context\n");
  await f.start();
  const output = f.render().join("\n");
  assert.match(output, /~1 configured extension/);
  assert.match(output, /~1 configured context/);
  assert.doesNotMatch(output, /loaded|active/);
  assert.match(output, /2 registered skills/);
  assert.match(output, /1 registered template/);
});

test("disabled package extensions do not inflate configured estimates", async (t) => {
  const f = await fixture(t);
  await f.save(".pi/agent/npm/node_modules/fixture/package.json", JSON.stringify({ pi: { extensions: ["extensions/*.ts"] } }));
  await f.save(".pi/agent/npm/node_modules/fixture/extensions/one.ts", "export default function () {}\n");
  await f.save(".pi/agent/settings.json", JSON.stringify({ packages: [{ source: "npm:fixture", extensions: [] }] }));
  await f.start();
  assert.match(f.render().join("\n"), /~0 configured extensions/);
});

test("startup config estimates respect package exclusions", async (t) => {
  const f = await fixture(t);
  await f.save(".pi/agent/npm/node_modules/fixture/package.json", JSON.stringify({ pi: { extensions: ["extensions/*.ts"] } }));
  await f.save(".pi/agent/npm/node_modules/fixture/extensions/one.ts", "export default function () {}\n");
  await f.save(".pi/agent/npm/node_modules/fixture/extensions/two.ts", "export default function () {}\n");
  await f.save(".pi/agent/settings.json", JSON.stringify({ packages: [{ source: "npm:fixture", extensions: ["!two.ts"] }] }));
  await f.start();
  assert.match(f.render().join("\n"), /~1 configured extension/);
});

test("narrow startup layout fits every line and keeps resource provenance visible", async (t) => {
  const f = await fixture(t);
  await f.start();
  for (const width of [44, 50, 60, 75, 76, 80, 120]) {
    const lines = f.render(width);
    assert.ok(lines.length > 0);
    assert.ok(lines.every((line) => [...line].length <= width), `overflow at ${width}`);
    assert.match(lines.join("\n"), /3 available models/);
    assert.match(lines.join("\n"), /configured extensions/);
    assert.match(lines.join("\n"), /registered skills/);
  }
  assert.deepEqual(f.render(43), []);
});
