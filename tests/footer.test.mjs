import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// Exercise the real Pi loader/jiti without changing the project's dev dependencies.
const piDir = process.env.PI_TEST_CODING_AGENT_DIR
  ? resolve(process.env.PI_TEST_CODING_AGENT_DIR)
  : dirname(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))));
const { loadExtensions } = await import(pathToFileURL(join(piDir, "dist/core/extensions/loader.js")));
const extensionPath = fileURLToPath(new URL("../agent/extensions/footer/index.ts", import.meta.url));
const statsConfig = {
  row1LeftSegments: ["token_in", "token_out", "cache_read", "cache_write", "cost", "thinking"],
  row1RightSegments: [], row2LeftSegments: ["context_pct", "context_total"], row2RightSegments: [],
};

function usage(input = 10) {
  return { input, output: 2, cacheRead: 3, cacheWrite: 4, totalTokens: input + 9,
    cost: { input: 0.04, output: 0.02, cacheRead: 0.02, cacheWrite: 0.02, total: 0.1 } };
}
function assistant(id, stopReason = "stop", input = 10) {
  return { type: "message", id, parentId: null, timestamp: new Date(0).toISOString(),
    message: { role: "assistant", content: [{ type: "text", text: "response" }],
      api: "openai-completions", provider: "fixture", model: "fixture", timestamp: 0,
      stopReason, usage: usage(input) } };
}

async function fixture(t, { config = statsConfig, entries = [assistant("a")], countAPI = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), "pikit-footer-"));
  const oldHome = process.env.HOME;
  process.env.HOME = root;
  t.after(async () => {
    if (oldHome === undefined) delete process.env.HOME;
    else process.env.HOME = oldHome;
    await rm(root, { recursive: true, force: true });
  });
  const configPath = join(root, ".pi", "agent", "configs", "footer.json");
  await mkdir(dirname(configPath), { recursive: true });
  if (config !== null) await writeFile(configPath, JSON.stringify(config));
  const state = {
    entries, branch: [assistant("active")], sessionId: "session-a", leafId: "leaf-a",
    thinking: "high", scans: 0, reads: 0, branchReads: 0, contextReads: 0,
    context: { tokens: 800, contextWindow: 2000, percent: 40 },
  };
  const manager = {
    getSessionId: () => state.sessionId,
    getLeafId: () => state.leafId,
    getEntries: () => {
      state.reads++;
      // Iteration is the expensive aggregation; length is the older-API fallback.
      const copy = [...state.entries];
      copy[Symbol.iterator] = function* () { state.scans++; yield* state.entries; };
      return copy;
    },
    getBranch: () => { state.branchReads++; return state.branch; },
  };
  if (countAPI) manager.getEntryCount = () => state.entries.length;
  const loaded = await loadExtensions([extensionPath], root);
  assert.deepEqual(loaded.errors, []);
  loaded.runtime.getThinkingLevel = () => state.thinking;
  const theme = { fg: (_name, text) => text };
  let component;
  const ctx = {
    cwd: root, hasUI: true, mode: "tui", sessionManager: manager,
    model: { id: "virtual", name: "Virtual", provider: "fixture", reasoning: true, contextWindow: 1000000 },
    modelRegistry: { isUsingOAuth: () => false },
    getContextUsage: () => { state.contextReads++; return state.context; },
    ui: { setFooter: (factory) => {
      component = factory({ requestRender() {} }, theme,
        { getGitBranch: () => null, onBranchChange: () => () => {} });
    } },
  };
  for (const handler of loaded.extensions[0].handlers.get("session_start")) {
    await handler({ type: "session_start", reason: "startup" }, ctx);
  }
  t.after(() => component?.dispose());
  return { state, ctx, root, configPath,
    emit: async (type, event) => {
      for (const handler of loaded.extensions[0].handlers.get(type) ?? []) await handler(event, ctx);
    },
    render: () => component.render(240)
      .map((line) => line.replace(/\x1b\[[0-9;]*m/g, "").trim()) };
}

// Omitting any host accounting category (or walking nested usage a second time) breaks this total.
test("footer totals all entries including spent errors, abandoned branches and nested parent usage", async (t) => {
  const entries = [assistant("success"), assistant("failed", "error"), assistant("cancelled", "aborted"),
    { type: "message", message: { role: "toolResult", toolCallId: "call", toolName: "nested",
      content: [], details: {}, isError: false, timestamp: 0, usage: usage(),
      nestedCalls: { complete: true, calls: [{ id: "call/0", name: "child", arguments: {},
        status: "ok", durationMs: 1 }] } } },
    { type: "compaction", usage: usage() }, { type: "branch_summary", usage: usage() },
    { type: "usage", provider: "fixture", model: "fixture", usage: usage() },
    { type: "message", message: { role: "toolResult", content: [], isError: false } },
    { type: "custom", usage: usage(999) }];
  const f = await fixture(t, { entries });
  assert.equal(f.render()[1], "↑ 70 ↓ 14 21 28 $0.70 high");
});

test("unchanged renders skip history scans and use live thinking level", async (t) => {
  const f = await fixture(t);
  f.state.branch.push({ type: "thinking_level_change", thinkingLevel: "off" });
  assert.match(f.render()[1], /high$/);
  f.state.thinking = "low";
  assert.match(f.render()[1], /low$/);
  f.render();
  assert.equal(f.state.scans, 1);
  assert.equal(f.state.reads, 1, "getEntryCount avoids copying entries on cache hits");
  assert.equal(f.state.branchReads, 0, "footer must not rebuild active branch/thinking history");
  assert.equal(f.state.contextReads, 1, "canonical context accounting also scans history on the host");
});

test("partial session APIs do not suppress unrelated footer segments", async (t) => {
  const f = await fixture(t, { config: { ...statsConfig, row1LeftSegments: ["text:status ready"] } });
  f.ctx.sessionManager = { getBranch: () => [] };
  assert.equal(f.render()[1], "status ready");
});

test("older Pi getEntries length fallback avoids repeated aggregation", async (t) => {
  const f = await fixture(t, { countAPI: false });
  f.render(); f.render(); f.render();
  assert.equal(f.state.scans, 1);
  assert.equal(f.state.reads, 3);
  assert.equal(f.state.branchReads, 0);
  f.state.entries.push(assistant("new"));
  assert.match(f.render()[1], /^↑ 20 ↓ 4/);
  assert.equal(f.state.scans, 2);
});

test("cache invalidates on leaf, count, session ID and manager identity, not branch length", async (t) => {
  const f = await fixture(t);
  f.render();
  f.state.leafId = "leaf-b";
  f.render();
  assert.equal(f.state.scans, 2);
  f.state.entries.push(assistant("other-branch", "stop", 30));
  assert.match(f.render()[1], /^↑ 40 ↓ 4/);
  f.state.sessionId = "session-b";
  f.state.entries = [assistant("replacement", "stop", 50), assistant("replacement-2", "stop", 60)];
  assert.match(f.render()[1], /^↑ 110 ↓ 4/);
  f.ctx.sessionManager = { ...f.ctx.sessionManager };
  f.render();
  assert.equal(f.state.scans, 5);
});

test("context meter uses canonical percent and physical window, including model changes", async (t) => {
  const f = await fixture(t);
  assert.match(f.render()[3], /40\.0% \/ 2\.0k 2000$/);
  // Percent is authoritative even when it differs from tokens / window.
  f.state.context = { tokens: 100, contextWindow: 4000, percent: 12.5 };
  f.ctx.model = { ...f.ctx.model, id: "new-virtual" };
  assert.match(f.render()[3], /12\.5% \/ 4\.0k 4000$/);
  f.ctx.model.contextWindow = 500000;
  f.state.context = { tokens: 50, contextWindow: 500, percent: 10 };
  assert.match(f.render()[3], /10\.0% \/ 500 500$/);
});

test("virtual context cache follows live physical catalog replacement, mutation and removal", async (t) => {
  const f = await fixture(t);
  f.ctx.model = { ...f.ctx.model, api: "pi-virtual" };
  let physical = { id: "physical", provider: "fixture", contextWindow: 2000 };
  f.ctx.modelRegistry.getAll = () => physical ? [physical] : [];
  f.ctx.getContextUsage = () => {
    f.state.contextReads++;
    const contextWindow = physical?.contextWindow ?? 1000000;
    return { tokens: 800, contextWindow, percent: 800 / contextWindow * 100 };
  };
  assert.match(f.render()[3], /40\.0% \/ 2\.0k 2000$/);
  f.render();
  assert.equal(f.state.contextReads, 1);
  physical = { ...physical, contextWindow: 4000 };
  assert.match(f.render()[3], /20\.0% \/ 4\.0k 4000$/);
  physical.contextWindow = 8000;
  assert.match(f.render()[3], /10\.0% \/ 8\.0k 8000$/);
  physical = undefined;
  assert.match(f.render()[3], /0\.1% \/ 1\.0M 1000000$/);
});

test("finalized routed response refreshes physical context before message persistence", async (t) => {
  const f = await fixture(t);
  assert.match(f.render()[3], /40\.0% \/ 2\.0k 2000$/);
  // Host agent state (and routed limits) changes before message_end persistence;
  // selected virtual model, leaf and count still have their previous identities.
  f.state.context = { tokens: 800, contextWindow: 4000, percent: 20 };
  await f.emit("message_end", { type: "message_end", message: assistant("routed").message });
  assert.match(f.render()[3], /20\.0% \/ 4\.0k 4000$/);
  f.render();
  assert.equal(f.state.contextReads, 2, "unchanged frames remain cached after refresh");
});

for (const context of [
  { tokens: null, contextWindow: 2000, percent: null },
  { tokens: 800, contextWindow: 2000, percent: null },
  undefined,
]) {
  test(`context unknown stays unknown (${JSON.stringify(context)}) without hiding the footer`, async (t) => {
    const f = await fixture(t);
    f.state.context = context;
    const lines = f.render();
    assert.equal(lines.length, 4);
    assert.match(lines[3], /\?/);
    assert.doesNotMatch(lines[3], /(?:0\.0|40\.0)%/);
    assert.match(lines[1], /\$0\.10/);
  });
}

for (const initial of ["missing", "malformed"]) {
  test(`config caches ${initial} result until TTL expires`, async (t) => {
    let now = 10000;
    t.mock.method(Date, "now", () => now);
    const f = await fixture(t, { config: null });
    if (initial === "malformed") await writeFile(f.configPath, "{broken");
    assert.doesNotMatch(f.render().join("\n"), /NEW-CONFIG/);
    await writeFile(f.configPath, JSON.stringify({ ...statsConfig, row1LeftSegments: ["text:NEW-CONFIG"] }));
    now += 4999;
    assert.doesNotMatch(f.render().join("\n"), /NEW-CONFIG/);
    now += 1;
    assert.match(f.render().join("\n"), /NEW-CONFIG/);
  });
}

test("config cache follows HOME path identity before TTL expiration", async (t) => {
  const f = await fixture(t, { config: { ...statsConfig, row1LeftSegments: ["text:HOME-A"] } });
  assert.equal(f.render()[1], "HOME-A");
  const secondHome = join(f.root, "other-home");
  const configPath = join(secondHome, ".pi", "agent", "configs", "footer.json");
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify({ ...statsConfig, row1LeftSegments: ["text:HOME-B"] }));
  process.env.HOME = secondHome;
  assert.equal(f.render()[1], "HOME-B");
  assert.ok(await readFile(configPath, "utf8"));
});
