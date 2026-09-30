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
const { KeybindingsManager } = await import(pathToFileURL(join(piDir, "dist/core/keybindings.js")));
const extensionPath = fileURLToPath(new URL("../agent/extensions/chat-input/index.ts", import.meta.url));

async function setup(t, enabled) {
  const root = await mkdtemp(join(tmpdir(), "pikit-editor-lifecycle-"));
  const home = process.env.HOME;
  process.env.HOME = root;
  t.after(async () => {
    if (home === undefined) delete process.env.HOME;
    else process.env.HOME = home;
    await rm(root, { recursive: true, force: true });
  });
  const dir = join(root, ".pi", "agent", "configs");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "chat-input.json"), JSON.stringify({ companion: { enabled } }));
  const loaded = await loadExtensions([extensionPath], root);
  assert.deepEqual(loaded.errors, []);
  const extension = loaded.extensions[0];
  let factory;
  const ctx = { ui: {
    theme: { fg: (_color, text) => text },
    setEditorComponent(value) { factory = value; },
    getEditorComponent() { return factory; },
  } };
  for (const handler of extension.handlers.get("session_start") ?? []) await handler({}, ctx);
  let renders = 0;
  const tui = { terminal: { rows: 40, columns: 80 }, requestRender() { renders++; } };
  const theme = { borderColor: (text) => text, selectList: {} };
  const timers = new Map();
  let nextId = 0;
  t.mock.method(globalThis, "setInterval", (callback) => {
    const id = ++nextId;
    timers.set(id, callback);
    return id;
  });
  t.mock.method(globalThis, "clearInterval", (id) => timers.delete(id));
  // Stable randomness without a repeated expression that would stall pickNextExpr.
  let random = false;
  t.mock.method(Math, "random", () => (random = !random) ? 0.25 : 0.75);
  const create = () => factory(tui, theme, new KeybindingsManager());
  const shutdown = async () => {
    for (const handler of extension.handlers.get("session_shutdown") ?? []) await handler({}, ctx);
  };
  t.after(shutdown);
  return { create, timers, shutdown,
    replace: (value) => ctx.ui.setEditorComponent(value),
    get renders() { return renders; } };
}

test("disabled companion creates no interval or idle render requests", async (t) => {
  const fixture = await setup(t, false);
  const editor = fixture.create();
  editor.render(80);
  assert.equal(fixture.timers.size, 0);
  assert.equal(fixture.renders, 0);
});

test("replacement and shutdown release companion intervals idempotently", async (t) => {
  const fixture = await setup(t, true);
  fixture.create().render(80);
  assert.equal(fixture.timers.size, 1);
  const oldCallback = [...fixture.timers.values()][0];
  fixture.create().render(80);
  assert.equal(fixture.timers.size, 1, "only the replacement may animate");
  const before = fixture.renders;
  oldCallback();
  assert.equal(fixture.renders, before, "disposed editor must not render");
  await fixture.shutdown();
  await fixture.shutdown();
  assert.equal(fixture.timers.size, 0);
});

for (const replacement of [undefined, () => ({ render: () => [] })]) {
  test(`external replacement (${replacement ? "another factory" : "default editor"}) stops detached animation`, async (t) => {
    const fixture = await setup(t, true);
    fixture.create().render(80);
    const tick = [...fixture.timers.values()][0];
    fixture.replace(replacement);
    tick(); // Pi does not dispose the detached editor; ownership must be checked.
    assert.equal(fixture.timers.size, 0);
    assert.equal(fixture.renders, 0);
  });
}

test("animation requests rendering only when visible artwork changes", async (t) => {
  const fixture = await setup(t, true);
  t.mock.timers.enable({ apis: ["Date"], now: 100000 });
  const editor = fixture.create();
  editor.render(80);
  const tick = [...fixture.timers.values()][0];
  tick(); // initializes expression/phase and changes the visible face
  assert.equal(fixture.renders, 1, "visible changes must request a render");
  editor.render(80);
  const before = fixture.renders;
  t.mock.timers.tick(100);
  tick(); // no visible change within the initial expression interval
  assert.equal(fixture.renders, before);
  editor.render(20); // companion is not visible at this width
  t.mock.timers.tick(60000);
  tick();
  assert.equal(fixture.renders, before, "hidden animation must not redraw the editor");
});
