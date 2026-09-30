import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// Use a host Pi installation to exercise newer contracts without changing dev dependencies:
// PI_TEST_CODING_AGENT_DIR=/path/to/@earendil-works/pi-coding-agent pnpm test
const piDir = process.env.PI_TEST_CODING_AGENT_DIR
  ? resolve(process.env.PI_TEST_CODING_AGENT_DIR)
  : dirname(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))));
const { loadExtensions } = await import(pathToFileURL(join(piDir, "dist/core/extensions/loader.js")));
const { createAllToolDefinitions } = await import(pathToFileURL(join(piDir, "dist/core/tools/index.js")));
const { version } = JSON.parse(await readFile(join(piDir, "package.json"), "utf8"));
const [major, minor] = version.split(".").map(Number);
const sessionCwdSupported = major > 0 || minor >= 85;
const structuredBashSupported = major > 0 || minor >= 99;
const cwdOptions = { skip: !sessionCwdSupported && `Pi ${version} predates session CWD support` };
const structuredOptions = { skip: !structuredBashSupported && `Pi ${version} predates structured Bash results` };
const extensionPath = fileURLToPath(new URL("../agent/extensions/styled-outputs/index.ts", import.meta.url));
let root, fallbackCwd, sessionCwd, tools, originals, ctx;

before(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "pikit-tool-contracts-")));
  fallbackCwd = join(root, "fallback");
  sessionCwd = join(root, "session");
  await mkdir(fallbackCwd);
  await mkdir(sessionCwd);
  for (const file of ["fixture.txt", "write-fixture.txt", "edit-fixture.txt"]) {
    await writeFile(join(fallbackCwd, file), "fallback content\n");
    await writeFile(join(sessionCwd, file), "session needle\n");
  }
  await writeFile(join(sessionCwd, "session-only.txt"), "session only\n");

  // The factories' fallback directory deliberately differs from the execution context.
  const previousCwd = process.cwd();
  try {
    process.chdir(fallbackCwd);
    const loaded = await loadExtensions([extensionPath], fallbackCwd);
    assert.deepEqual(loaded.errors, []);
    tools = new Map([...loaded.extensions[0].tools].map(([name, tool]) => [name, tool.definition]));
    originals = createAllToolDefinitions(fallbackCwd);
  } finally {
    process.chdir(previousCwd);
  }
  ctx = {
    cwd: sessionCwd,
    model: {
      provider: "test-provider", id: "test-model", name: "Test model",
      api: "openai-responses", baseUrl: "https://example.invalid",
      input: ["text", "image"], reasoning: true, contextWindow: 128000, maxTokens: 8192,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
    thinkingLevel: "high",
    sessionManager: {
      getSessionId: () => "test-session",
      getSessionFile: () => join(sessionCwd, "session.jsonl"),
    },
  };
});

after(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

function execute(name, args, signal, onUpdate) {
  return tools.get(name).execute(`test-${name}`, args, signal, onUpdate, ctx);
}

function text(result) {
  return result.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
}

for (const name of ["read", "bash", "edit", "write", "grep", "find", "ls"]) {
  test(`${name} retains built-in metadata and custom renderers`, () => {
    const styled = tools.get(name);
    const original = originals[name];
    for (const [key, value] of Object.entries(original)) {
      if (["execute", "renderCall", "renderResult", "renderShell", "promptGuidelines"].includes(key)) continue;
      assert.deepEqual(styled[key], value, `${name}.${key}`);
    }
    for (const guideline of original.promptGuidelines ?? []) {
      assert.ok(styled.promptGuidelines?.includes(guideline), `${name} lost guideline: ${guideline}`);
    }
    assert.equal(typeof styled.renderCall, "function");
    assert.equal(typeof styled.renderResult, "function");
    assert.equal(styled.renderShell, name === "edit" ? "default" : original.renderShell);
  });
}

test("read resolves relative paths against the session CWD", cwdOptions, async () => {
  assert.equal(text(await execute("read", { path: "fixture.txt" })), "session needle\n");
});

test("write writes in the session CWD, not the factory CWD", cwdOptions, async () => {
  await execute("write", { path: "write-fixture.txt", content: "session written\n" });
  assert.equal(await readFile(join(sessionCwd, "write-fixture.txt"), "utf8"), "session written\n");
  assert.equal(await readFile(join(fallbackCwd, "write-fixture.txt"), "utf8"), "fallback content\n");
});

test("edit edits in the session CWD and retains argument preparation", cwdOptions, async () => {
  const args = tools.get("edit").prepareArguments({
    path: "edit-fixture.txt", oldText: "session needle", newText: "session edited",
  });
  await execute("edit", args);
  assert.equal(await readFile(join(sessionCwd, "edit-fixture.txt"), "utf8"), "session edited\n");
  assert.equal(await readFile(join(fallbackCwd, "edit-fixture.txt"), "utf8"), "fallback content\n");
});

test("ls defaults to the session CWD", cwdOptions, async () => {
  assert.match(text(await execute("ls", {})), /session-only\.txt/);
});

test("find defaults to the session CWD", cwdOptions, async () => {
  assert.match(text(await execute("find", { pattern: "session-only.txt" })), /session-only\.txt/);
});

test("grep defaults to the session CWD", cwdOptions, async () => {
  assert.match(text(await execute("grep", { pattern: "session needle" })), /fixture\.txt:1:.*session needle/);
});

test("bash receives the session CWD and session/model environment", cwdOptions, async () => {
  const command = 'printf "%s\\n" "$PWD" "$PI_SESSION_ID" "$PI_SESSION_FILE" "$PI_PROVIDER" "$PI_MODEL" "$PI_REASONING_LEVEL"';
  assert.equal(text(await execute("bash", { command })),
    `${sessionCwd}\ntest-session\n${join(sessionCwd, "session.jsonl")}\ntest-provider\ntest-model\nhigh\n`);
});

test("bash retains its output schema and structured nonzero exit result", structuredOptions, async () => {
  assert.ok(tools.get("bash").outputSchema);
  const result = await execute("bash", { command: "printf 'structured output'; exit 7" });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.exit_code, 7);
  assert.equal(result.structuredContent.output, "structured output");
  assert.equal(result.structuredContent.truncated, false);
  assert.equal(typeof result.structuredContent.wall_time_seconds, "number");
});

test("bash forwards streaming updates", async () => {
  const updates = [];
  const result = await execute("bash", { command: "printf 'streamed output'" }, undefined,
    (update) => updates.push(update));
  assert.equal(text(result), "streamed output");
  assert.ok(updates.some((update) => text(update).includes("streamed output")));
});

test("bash respects an already-aborted execution signal", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(execute("bash", { command: "printf 'must not run'" }, controller.signal), /abort/i);
});
