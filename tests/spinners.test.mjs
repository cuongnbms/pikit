import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const piDir = process.env.PI_TEST_CODING_AGENT_DIR
  ? resolve(process.env.PI_TEST_CODING_AGENT_DIR)
  : dirname(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))));
const { loadExtensions } = await import(pathToFileURL(join(piDir, "dist/core/extensions/loader.js")));
const extensionPath = fileURLToPath(new URL("../agent/extensions/spinners/index.ts", import.meta.url));

async function fixture(t, hasUI = true) {
  const root = await mkdtemp(join(tmpdir(), "pikit-spinner-"));
  const oldHome = process.env.HOME;
  process.env.HOME = root;
  t.after(async () => {
    if (oldHome === undefined) delete process.env.HOME;
    else process.env.HOME = oldHome;
    await rm(root, { recursive: true, force: true });
  });
  const loaded = await loadExtensions([extensionPath], root);
  assert.deepEqual(loaded.errors, []);
  const messages = [], indicators = [];
  const ctx = { hasUI, ui: {
    theme: { fg: (_color, text) => text },
    setWorkingMessage: (message) => messages.push(message),
    setWorkingIndicator: (options) => indicators.push(options),
  } };
  async function emit(type, extra = {}) {
    for (const handler of loaded.extensions[0].handlers.get(type) ?? []) {
      await handler({ type, ...extra }, ctx);
    }
  }
  t.after(() => emit("session_shutdown"));
  return { messages, indicators, emit };
}

test("working status shows the complete verb immediately and uses one line during streaming", async (t) => {
  const f = await fixture(t);
  t.mock.method(Math, "random", () => 0);
  t.mock.timers.enable({ apis: ["Date", "setInterval", "setTimeout"], now: 100000 });
  await f.emit("turn_start");
  assert.equal(f.messages.at(-1), "Accomplishing… (0s)");
  t.mock.timers.tick(1000);
  assert.equal(f.messages.at(-1), "Accomplishing… (1s)");
  await f.emit("message_update", { assistantMessageEvent: { type: "text_start", contentIndex: 0 } });
  t.mock.timers.tick(37000);
  await f.emit("message_update", { assistantMessageEvent: {
    type: "text_delta", contentIndex: 0, delta: "x".repeat(4936),
  } });
  assert.equal(f.messages.at(-1), "Accomplishing… (38s · ↓ 1,234 tokens)");
  assert.ok(f.messages.every((message) => !message.includes("\n") && !message.includes("└")));
});

test("working verb stays fixed while elapsed time advances throughout a turn", async (t) => {
  const f = await fixture(t);
  let randomValue = 0;
  t.mock.method(Math, "random", () => randomValue);
  t.mock.timers.enable({ apis: ["Date", "setInterval", "setTimeout"], now: 100000 });
  await f.emit("turn_start");
  randomValue = 0.5;
  for (let second = 1; second <= 10; second++) {
    t.mock.timers.tick(1000);
    assert.equal(f.messages.at(-1), `Accomplishing… (${second}s)`);
  }
});

test("elapsed time keeps refreshing between streamed text chunks", async (t) => {
  const f = await fixture(t);
  t.mock.method(Math, "random", () => 0);
  t.mock.timers.enable({ apis: ["Date", "setInterval", "setTimeout"], now: 100000 });
  await f.emit("turn_start");
  await f.emit("message_update", { assistantMessageEvent: { type: "text_start", contentIndex: 0 } });
  await f.emit("message_update", { assistantMessageEvent: {
    type: "text_delta", contentIndex: 0, delta: "test",
  } });
  t.mock.timers.tick(1000);
  assert.equal(f.messages.at(-1), "Accomplishing… (1s · ↓ 1 tokens)");
});

test("working indicator animates Claude-style stars and restores host defaults on turn end", async (t) => {
  const f = await fixture(t);
  t.mock.timers.enable({ apis: ["Date", "setInterval", "setTimeout"], now: 100000 });
  await f.emit("turn_start");
  assert.deepEqual(f.indicators.at(-1), {
    frames: ["·", "✢", "✳", "✶", "✻", "✽"], intervalMs: 120,
  });
  await f.emit("turn_end");
  assert.equal(f.indicators.at(-1), undefined);
  assert.equal(f.messages.at(-1), undefined);
  const count = f.messages.length;
  t.mock.timers.tick(10000);
  assert.equal(f.messages.length, count, "no spinner updates after turn end");
});

for (const event of ["agent_end", "session_shutdown"]) {
  test(`${event} restores the working UI even without turn_end`, async (t) => {
    const f = await fixture(t);
    t.mock.timers.enable({ apis: ["Date", "setInterval", "setTimeout"], now: 100000 });
    await f.emit("turn_start");
    await f.emit(event);
    assert.equal(f.indicators.at(-1), undefined);
    assert.equal(f.messages.at(-1), undefined);
    const count = f.messages.length;
    t.mock.timers.tick(10000);
    assert.equal(f.messages.length, count);
  });
}

test("non-interactive turns do not customize the working UI", async (t) => {
  const f = await fixture(t, false);
  await f.emit("turn_start");
  await f.emit("turn_end");
  await f.emit("agent_end");
  assert.deepEqual(f.messages, []);
  assert.deepEqual(f.indicators, []);
});
