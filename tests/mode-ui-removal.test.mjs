import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// Match styled-outputs.test.mjs: load real TypeScript modules through Pi's jiti loader.
const piDir = process.env.PI_TEST_CODING_AGENT_DIR
  ? resolve(process.env.PI_TEST_CODING_AGENT_DIR)
  : dirname(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))));
const { loadExtensions } = await import(pathToFileURL(join(piDir, "dist/core/extensions/loader.js")));
const { KeybindingsManager } = await import(pathToFileURL(join(piDir, "dist/core/keybindings.js")));
const extensionPath = (name) => fileURLToPath(new URL(`../agent/extensions/${name}/index.ts`, import.meta.url));
const stripAnsi = (text) => text.replace(/\x1b\[[0-9;]*m/g, "");
const tui = { terminal: { rows: 40, columns: 80 }, requestRender() {} };
const editorTheme = { borderColor: (text) => text, selectList: {} };
let root, configDir, previousHome, previousCwd;
const globals = ["__planMode", "__chatMode", "__footerRequestRender"];
const previousGlobals = new Map(globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));

before(async () => {
  root = await mkdtemp(join(tmpdir(), "pikit-mode-ui-"));
  configDir = join(root, ".pi", "agent", "configs");
  await mkdir(configDir, { recursive: true });
  previousHome = process.env.HOME;
  previousCwd = process.cwd();
  process.env.HOME = root;
  process.chdir(root);
});

after(async () => {
  process.chdir(previousCwd);
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  for (const key of globals) {
    const descriptor = previousGlobals.get(key);
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
  await rm(root, { recursive: true, force: true });
});

async function load(name) {
  const loaded = await loadExtensions([extensionPath(name)], root);
  assert.deepEqual(loaded.errors, []);
  loaded.runtime.getCommands = () => [];
  loaded.runtime.getThinkingLevel = () => "off";
  return loaded.extensions[0];
}

async function start(extension, ctx) {
  for (const handler of extension.handlers.get("session_start") ?? []) {
    await handler({ type: "session_start" }, ctx);
  }
}

function setModes(plan, chat) {
  globalThis.__planMode = { mode: plan };
  globalThis.__chatMode = { mode: chat };
}

async function createEditor(t, boxedView) {
  await writeFile(join(configDir, "chat-input.json"), JSON.stringify({
    boxedView, prefix: "❯", borderColor: "border", prefixColor: "accent",
    companion: { enabled: false },
    // Old config fields must be inert, including user-supplied custom colors/prefixes.
    planModeBorderColor: "legacyPlanBorder", planModePrefixColor: "legacyPlanPrefix", planModePrefix: "PLAN",
    chatModeBorderColor: "legacyChatBorder", chatModePrefixColor: "legacyChatPrefix", chatModePrefix: "CHAT",
  }));
  const extension = await load("chat-input");
  const colors = [];
  const theme = {
    fg(color, text) {
      colors.push(color);
      const codes = { border: 90, accent: 36, bashMode: 32 };
      return `\x1b[${codes[color] ?? 35}m${text}\x1b[0m`;
    },
  };
  let factory;
  await start(extension, { ui: { theme, setEditorComponent(value) { factory = value; } } });
  // The real editor owns an idle companion interval even when disabled. Prevent it
  // from ticking or keeping the test process alive; node:test restores timers.
  t.mock.timers.enable({ apis: ["setInterval"] });
  const editor = factory(tui, editorTheme, new KeybindingsManager());
  return { editor, colors };
}

for (const boxedView of [true, false]) {
  const layout = boxedView ? "boxed" : "unboxed";
  test(`${layout} editor renders the normal prefix regardless of stale CHAT/PLAN globals`, async (t) => {
    const { editor } = await createEditor(t, boxedView);
    delete globalThis.__planMode;
    delete globalThis.__chatMode;
    editor.setText("ordinary input");
    const normal = editor.render(80);
    assert.match(stripAnsi(normal.join("\n")), /❯ ordinary input/);
    assert.ok(stripAnsi(normal[0]).startsWith(boxedView ? "┌─" : "──"));
    for (const [plan, chat] of [["plan", "off"], ["execute", "off"], ["off", "chat"], ["plan", "chat"]]) {
      setModes(plan, chat);
      assert.deepEqual(editor.render(80), normal, `stale plan=${plan}, chat=${chat} changed the editor`);
    }
  });

  test(`${layout} editor never requests custom mode colors from legacy config`, async (t) => {
    const { editor, colors } = await createEditor(t, boxedView);
    editor.setText("ordinary input");
    for (const [plan, chat] of [["plan", "off"], ["execute", "off"], ["off", "chat"]]) {
      setModes(plan, chat);
      colors.length = 0;
      editor.render(80);
      assert.ok(colors.length > 0);
      assert.deepEqual([...new Set(colors)].sort(), ["accent", "border"]);
    }
  });

  test(`${layout} editor keeps bash styling and the normal prefix with stale mode globals`, async (t) => {
    const { editor, colors } = await createEditor(t, boxedView);
    setModes("execute", "chat");
    editor.setText("!printf hello");
    const rendered = editor.render(80);
    assert.match(stripAnsi(rendered.join("\n")), /❯ !printf hello/);
    assert.deepEqual([...new Set(colors)], ["bashMode"]);
    assert.ok(stripAnsi(rendered[0]).startsWith(boxedView ? "┌─" : "──"));
  });
}

// Reintroducing deleted shortcut tips would advertise commands that no longer exist.
test("startup advertises normal commands, bash, model and thinking tips, not mode toggles", async () => {
  await writeFile(join(configDir, "chat-mode.json"), JSON.stringify({ shortcuts: { toggleMode: "alt+c" } }));
  await writeFile(join(configDir, "plan-mode.json"), JSON.stringify({ shortcuts: { toggleMode: "alt+l" } }));
  const extension = await load("startup");
  let factory;
  await start(extension, { hasUI: true, ui: { setHeader(value) { factory = value; } } });
  const header = factory(tui, { fg: (_color, text) => text });
  const output = stripAnsi(header.render(100).join("\n"));
  assert.match(output, /pi\.dev agent v/);
  assert.match(output, /for commands/);
  assert.match(output, /to run bash/);
  assert.match(output, /cycle model/);
  assert.match(output, /cycle thinking/);
  assert.doesNotMatch(output, /chat mode|plan mode|alt\+c|alt\+l|ctrl\+shift\+[cl]/i);
  assert.deepEqual(header.render(40), []);
});

// Old user JSON may still select deleted IDs. They must behave like unknown
// segments, without suppressing the rest of a valid footer or throwing.
test("legacy footer mode segment IDs stay hidden with active stale globals", async () => {
  await writeFile(join(configDir, "footer.json"), JSON.stringify({
    row1LeftSegments: ["text:normal status"], row1RightSegments: [],
    row2LeftSegments: ["plan_mode", "chat_mode", "text:status ready"], row2RightSegments: [],
  }));
  const extension = await load("footer");
  let factory;
  await start(extension, {
    hasUI: true, sessionManager: { getBranch: () => [] },
    ui: { setFooter(value) { factory = value; } },
  });
  const footer = factory(tui, { fg: (_color, text) => text }, {
    getGitBranch: () => null, onBranchChange: () => () => {},
  });
  try {
    for (const [plan, chat] of [["plan", "chat"], ["execute", "chat"], ["off", "off"]]) {
      setModes(plan, chat);
      const rows = footer.render(100).map(stripAnsi);
      assert.equal(rows[1].trim(), "normal status");
      assert.equal(rows[3].trim(), "status ready");
    }
  } finally {
    footer.dispose();
  }
});
