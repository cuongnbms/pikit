import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// Match the host override used by styled-outputs.test.mjs without changing dependencies.
const piDir = process.env.PI_TEST_CODING_AGENT_DIR
  ? resolve(process.env.PI_TEST_CODING_AGENT_DIR)
  : dirname(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))));
const requirePi = createRequire(join(piDir, "package.json"));
const piEntry = join(piDir, "dist/index.js");
const tuiEntry = requirePi.resolve("@earendil-works/pi-tui");
const pi = await import(pathToFileURL(piEntry));
const tui = await import(pathToFileURL(tuiEntry));
const { loadExtensions } = await import(pathToFileURL(join(piDir, "dist/core/extensions/loader.js")));
const themeModule = await import(pathToFileURL(join(piDir, "dist/modes/interactive/theme/theme.js")));
const { createJiti } = requirePi("jiti");
const jiti = createJiti(import.meta.url, {
  alias: { "@earendil-works/pi-coding-agent": piEntry, "@earendil-works/pi-tui": tuiEntry },
});
const extensionDir = fileURLToPath(new URL("../agent/extensions/styled-outputs/", import.meta.url));
const utils = await jiti.import(join(extensionDir, "utils.ts"));
const shared = await jiti.import(join(extensionDir, "components/tool-shared.ts"));
const fallback = await jiti.import(join(extensionDir, "components/fallback-renderer.ts"));
const { CONFIG } = await jiti.import(join(extensionDir, "config.ts"));
const { version } = JSON.parse(await readFile(join(piDir, "package.json"), "utf8"));
// Feature detection, not a version assumption: older dev Pi has no MouseRegion/transformers.
const mouseOptions = { skip: !tui.MouseRegion && `Pi ${version} predates thinking mouse regions` };
const transformOptions = { skip: !existsSync(join(piDir, "dist/modes/interactive/components/markdown-transform.js")) && `Pi ${version} predates Markdown transformers` };
const codemodeOptions = { skip: !existsSync(join(piDir, "dist/extensions/codemode/renderer.js")) && `Pi ${version} predates codemode` };
let extension, theme, mdTheme;
const ui = { requestRender() {} };
const activeTimers = new Set();
const setIntervalNative = globalThis.setInterval;
const clearIntervalNative = globalThis.clearInterval;
let timerStarts = 0;

async function emit(ext, name, event = {}) {
  for (const handler of ext.handlers.get(name) ?? []) await handler(event, { ui: { theme } });
}
async function load() {
  const result = await loadExtensions([join(extensionDir, "index.ts")], process.cwd());
  assert.deepEqual(result.errors, []);
  const ext = result.extensions[0];
  await emit(ext, "session_start");
  return ext;
}
before(async () => {
  themeModule.initTheme("dark");
  theme = themeModule.theme;
  mdTheme = themeModule.getMarkdownTheme();
  utils.setCurrentTheme(theme);
  globalThis.setInterval = (...args) => {
    timerStarts++;
    const timer = setIntervalNative(...args);
    activeTimers.add(timer);
    return timer;
  };
  globalThis.clearInterval = (timer) => {
    activeTimers.delete(timer);
    return clearIntervalNative(timer);
  };
  extension = await load();
});
after(async () => {
  if (extension) await emit(extension, "session_shutdown");
  for (const timer of activeTimers) clearIntervalNative(timer);
  activeTimers.clear();
  globalThis.setInterval = setIntervalNative;
  globalThis.clearInterval = clearIntervalNative;
  themeModule.stopThemeWatcher();
});
const unbranch = (row) => row.trim().replace(/^⎿\s*/, "");
const plain = (lines) => lines.map((line) => line.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, ""));
const display = (component, width = 80) => plain(component.render(width));
const resultContext = (extra = {}) => ({ state: {}, args: {}, expanded: true, isPartial: false, isError: false, invalidate() {}, ...extra });
function assertFits(component, width) {
  for (const row of component.render(width)) assert.ok(tui.visibleWidth(row) <= width,
    `row uses ${tui.visibleWidth(row)} columns at width ${width}: ${JSON.stringify(row)}`);
}
function assistant(content) {
  return { role: "assistant", content, stopReason: "stop", timestamp: 0 };
}
function tool(name, definition) {
  return new pi.ToolExecutionComponent(name, `id-${name}`, {}, { showImages: false }, definition, ui, process.cwd());
}
function finishTool(component) {
  component.updateResult({ content: [], details: {} }, false);
}

test("renderer-owned tools receive partial nested-call progress", codemodeOptions, async () => {
  const { codemodeRenderers } = await import(pathToFileURL(join(piDir, "dist/extensions/codemode/renderer.js")));
  const component = tool("codemode", { name: "codemode", ...codemodeRenderers });
  component.updateResult({ content: [], details: { calls: [{ name: "nested-read", args: "fixture.txt", status: "running" }] } }, true);
  assert.match(display(component).join("\n"), /nested-read.*fixture\.txt/);
});

test("styled built-in and fallback results remain spinner-only during partial updates", () => {
  for (const name of ["bash", "read", "edit", "write", "grep", "find", "ls", "unknown"]) {
    const definition = extension.tools.get(name)?.definition ?? { name };
    const component = tool(name, definition);
    try {
      component.setExpanded(true);
      component.updateResult({ content: [{ type: "text", text: "SECRET_PARTIAL_OUTPUT" }], details: {} }, true);
      const output = display(component).join("\n");
      assert.match(output, /Running/);
      assert.doesNotMatch(output, /SECRET_PARTIAL_OUTPUT|Done/);
    } finally { finishTool(component); }
  }
});

test("assistant streaming state reaches retained Markdown transformers", transformOptions, () => {
  const transformer = (_text, context) => `${context.messageType}:${context.isStreaming ? "streaming" : "settled"}`;
  const component = new pi.AssistantMessageComponent(undefined, false, mdTheme, "Thinking...", 1, [transformer]);
  const message = assistant([{ type: "text", text: "raw answer" }]);
  component.updateContent(message, true);
  assert.match(display(component).join("\n"), /assistant:streaming/);
  component.updateContent(message, false);
  assert.match(display(component).join("\n"), /assistant:settled/);
});

test("thinking styling retains clickable mouse wrapper and transformer across hide/show", mouseOptions, () => {
  const transformer = (_text, context) => `${context.messageType}:${context.isStreaming ? "streaming" : "settled"}`;
  const component = new pi.AssistantMessageComponent(undefined, false, mdTheme, "Thinking...", 1, [transformer]);
  component.updateContent(assistant([{ type: "thinking", thinking: "raw thought" }]), true);
  let region = component.contentContainer.children.find((child) => child instanceof tui.MouseRegion);
  assert.ok(region);
  let output = display(region).join("\n");
  assert.match(output, new RegExp(CONFIG.thinkingMessage.prefix));
  assert.match(output, /assistant-thinking:streaming/);
  assert.match(region.render(80).join("\n"), /\x1b\[3m/);
  const click = { type: "click", button: "left", x: 0, y: 0, width: 80, height: 1 };
  assert.equal(region.handleMouse(click)?.handled, true);
  assert.match(display(component).join("\n"), /Thinking\.\.\./);
  region = component.contentContainer.children.find((child) => child instanceof tui.MouseRegion);
  assert.equal(region.handleMouse(click)?.handled, true);
  output = display(component).join("\n");
  assert.match(output, /assistant-thinking:streaming/);
  assert.match(output, new RegExp(CONFIG.thinkingMessage.prefix));
});

test("user styling locates the native Box and survives layout rebuilding", () => {
  const component = new pi.UserMessageComponent("9. literal\\_marker", mdTheme, 1);
  assert.match(display(component).join("\n"), new RegExp(CONFIG.userMessage.prefix));
  component.setOutputPad(2);
  assert.match(display(component).join("\n"), new RegExp(CONFIG.userMessage.prefix));
});

test("user styling preserves native Markdown options and transformers", transformOptions, () => {
  const component = new pi.UserMessageComponent("raw", mdTheme, 1, [() => "9. literal\\_marker"]);
  const output = display(component).join("\n");
  assert.match(output, /9\. literal\\_marker/);
  assert.match(output, new RegExp(CONFIG.userMessage.prefix));
});

test("completed Bash replay never starts a styled timer and preserves native completion state", () => {
  const component = new pi.BashExecutionComponent("replay command", ui);
  const starts = timerStarts;
  component.setComplete(7, false, { truncated: true }, "/tmp/full-output.txt");
  assert.equal(timerStarts, starts, "setComplete must not initialize a running spinner");
  component.render(80);
  component.setExpanded(true);
  component.invalidate();
  assert.equal(timerStarts, starts, "completed renders must not create timers");
  assert.equal(component.status, "error");
  assert.equal(component.exitCode, 7);
  assert.equal(component.fullOutputPath, "/tmp/full-output.txt");
  assert.match(display(component).join("\n"), /Output truncated/);
});

test("expanded Bash replay preserves blank output rows", () => {
  const component = new pi.BashExecutionComponent("blank output", ui);
  try {
    component.appendOutput("first\n\nsecond");
    component.setComplete(0, false);
    component.setExpanded(true);
    const rows = display(component).map(unbranch);
    const first = rows.indexOf("first");
    assert.deepEqual(rows.slice(first, first + 3), ["first", "", "second"]);
  } finally { component.setComplete(0, false); }
});

test("Bash replay derives Command versus Shell from each native instance, not last event", async () => {
  await emit(extension, "user_bash", { excludeFromContext: true });
  const included = new pi.BashExecutionComponent("included", ui, false);
  included.setComplete(0, false);
  assert.match(display(included).join("\n"), /(?<!!)! included/);
  await emit(extension, "user_bash", { excludeFromContext: false });
  const excluded = new pi.BashExecutionComponent("excluded", ui, true);
  excluded.setComplete(0, false);
  assert.match(display(excluded).join("\n"), /!! excluded/);
  assert.match(display(included).join("\n"), /(?<!!)! included/);
});

test("reload registers lifecycle cleanup despite prototype patch flag and stops running Bash timers", async () => {
  const running = new pi.BashExecutionComponent("running old session", ui);
  running.render(80);
  assert.ok(activeTimers.size > 0);
  const reloaded = await load();
  assert.ok((reloaded.handlers.get("session_shutdown") ?? []).length > 0, "new runtime needs its own shutdown observer");
  await emit(reloaded, "session_shutdown");
  assert.equal(activeTimers.size, 0, "shutdown must clear replay and running timers across prototype reloads");
  running.setComplete(0, false);
  extension = reloaded;
});

test("shutdown clears partial built-in and fallback spinner timers", async () => {
  await emit(extension, "session_start");
  const components = [tool("read", extension.tools.get("read").definition), tool("unknown", { name: "unknown" })];
  try {
    for (const component of components) component.render(80);
    assert.ok(activeTimers.size > 0);
    await emit(extension, "session_shutdown");
    assert.equal(activeTimers.size, 0);
    for (const component of components) component.render(80);
    assert.equal(activeTimers.size, 0, "detached rendering must not revive a stopped spinner");
  } finally {
    components.forEach(finishTool);
    await emit(extension, "session_start");
  }
});

test("Command versus Shell is semantic even when dim and bashMode colors coincide", () => {
  const colors = theme.fgAnsi ?? theme.fgColors;
  const dim = colors.get("dim");
  const bashMode = colors.get("bashMode");
  try {
    colors.set("dim", "\x1b[31m");
    colors.set("bashMode", "\x1b[31m");
    for (const [excluded, label] of [[false, "(?<!!)!"], [true, "!!"]]) {
      const component = new pi.BashExecutionComponent("same colors", ui, excluded);
      component.setComplete(0, false);
      assert.match(display(component).join("\n"), new RegExp(`${label} same colors`));
    }
  } finally {
    colors.set("dim", dim);
    colors.set("bashMode", bashMode);
  }
});

test("image-only native Read reports the image when terminal images are disabled", () => {
  const component = tool("read", extension.tools.get("read").definition);
  component.updateArgs({ path: "image.png" });
  component.updateResult({ content: [{ type: "image", data: "", mimeType: "image/png" }], details: {} }, false);
  assert.match(display(component).join("\n"), /1 image/);
});

test("narrow native assistant and thinking retain fitting body characters", () => {
  for (const [text, width] of [["ABCDE", 4], ["界界", 5]]) {
    for (const type of ["text", "thinking"]) {
      const content = type === "text" ? { type, text } : { type, thinking: text };
      const component = new pi.AssistantMessageComponent(assistant([content]), false, mdTheme);
      const prefix = type === "text" ? CONFIG.assistantMessage.prefix : CONFIG.thinkingMessage.prefix;
      // The thinking label sits on its own header row; only body rows carry the text.
      const rows = display(component, width).filter((row) => type === "text" || !row.includes(prefix));
      const body = rows.join("").replaceAll(prefix, "").replace(/\s/g, "");
      assert.equal(body, text, `${type} at width ${width}`);
      assertFits(component, width);
    }
  }
});

test("makeText skips unchanged writes but retains native invalidation and changed text", () => {
  const component = shared.makeText(undefined, "first");
  const rows = component.render(80);
  const nativeSetText = component.setText;
  let writes = 0;
  component.setText = function (...args) { writes++; return nativeSetText.apply(this, args); };
  assert.equal(shared.makeText(component, "first"), component);
  assert.equal(writes, 0, "unchanged text must keep the native width cache");
  assert.equal(component.render(80), rows);
  component.invalidate();
  assert.notEqual(component.render(80), rows, "native invalidate must still clear the width cache");
  shared.makeText(component, "second");
  assert.equal(writes, 1);
  assert.match(display(component).join("\n"), /second/);
  component.setText("external");
  shared.makeText(component, "second");
  assert.match(display(component).join("\n"), /second/, "native setText changes cannot poison the helper cache");
});

test("Bash caches output derivation and Text across renders and same-line native mutations", () => {
  const component = new pi.BashExecutionComponent("cache output", ui);
  let joins = 0;
  const lines = component.outputLines;
  lines.join = function (...args) { joins++; return Array.prototype.join.apply(this, args); };
  try {
    component.appendOutput("first\n\nsecond");
    component.setExpanded(true);
    const text = component.contentContainer.children[0];
    const nativeSetText = text.setText;
    let writes = 0;
    text.setText = function (...args) { writes++; return nativeSetText.apply(this, args); };
    const derived = joins;
    display(component);
    display(component);
    assert.equal(joins, derived, "render/spinner-only updates must not join or retruncate output");
    assert.equal(component.contentContainer.children[0], text, "Text must remain attached");
    assert.equal(writes, 0, "unchanged display must not reset the width cache");
    const beforeSpinner = component.render(80).join("\n");
    component._spinnerFrame++;
    const afterSpinner = component.render(80).join("\n");
    assert.notEqual(afterSpinner, beforeSpinner, "spinner must not freeze with output cache");
    assert.equal(joins, derived);
    component.appendOutput(" tail");
    assert.match(display(component).join("\n"), /second tail/);
    assert.equal(component.outputLines, lines, "exercise native in-place same-line append");
    component.outputLines[0] = "FIRST";
    component.invalidate(); // Direct non-native edits notify through the native invalidation contract.
    assert.match(display(component).join("\n"), /FIRST/);
    component.outputLines.splice(1, 2, "replacement");
    assert.match(display(component).join("\n"), /replacement/);
    component.outputLines = ["new array"];
    assert.match(display(component).join("\n"), /new array/);
    component.setExpanded(false);
    assert.match(display(component).join("\n"), /new array/, "collapsed output keeps a short preview");
    component.setComplete(4, false, { truncated: true }, "/tmp/one.txt");
    assert.match(display(component).join("\n"), /Error: Exit 4/);
    component.fullOutputPath = "/tmp/two.txt";
    assert.match(display(component).join("\n"), /Full output: \/tmp\/two.txt/);
    component.truncationResult.truncated = false;
    assert.doesNotMatch(display(component).join("\n"), /Output truncated/);
    component.setComplete(0, true);
    assert.match(display(component).join("\n"), /Cancelled/);
    assert.doesNotMatch(display(component).join("\n"), /Running/);
    component.setExpanded(true);
    assert.match(display(component).join("\n"), /new array/);
    for (const width of [4, 20, 80]) assertFits(component, width);
  } finally { component.setComplete(0, false); }
});

test("built-in results cache derived output without stale in-place content, flags or colors", () => {
  for (const name of ["read", "bash", "grep", "find", "ls", "edit", "write"]) {
    const render = extension.tools.get(name).definition.renderResult;
    const ctx = resultContext({ expanded: false });
    const options = { expanded: false, isPartial: false };
    const result = { content: [{ type: "text", text: "first\n\nsecond" }], details: {} };
    let component = render(result, options, theme, ctx);
    ctx.lastComponent = component;
    const nativeSetText = component.setText;
    let writes = 0;
    component.setText = function (...args) { writes++; return nativeSetText.apply(this, args); };
    const nativeSplit = String.prototype.split;
    let outputSplits = 0;
    String.prototype.split = function (...args) {
      if (String(this) === "first\n\nsecond") outputSplits++;
      return nativeSplit.apply(this, args);
    };
    try { assert.equal(render(result, options, theme, ctx), component); }
    finally { String.prototype.split = nativeSplit; }
    assert.equal(outputSplits, 0, `${name} must not resplit unchanged output`);
    assert.equal(writes, 0, `${name} must reuse unchanged output`);
    result.content[0].text = "changed\nthird\nfourth";
    options.expanded = ctx.expanded = true;
    ctx.isError = true;
    component = render(result, options, theme, ctx);
    ctx.lastComponent = component;
    assert.match(display(component).join("\n"), /changed/);
    assert.doesNotMatch(display(component).join("\n"), /first|second/);
    result.content.push({ type: "text", text: "last block" });
    component = render(result, options, theme, ctx);
    ctx.lastComponent = component;
    assert.match(display(component).join("\n"), /last block/);
    options.isPartial = true;
    component = render(result, options, theme, ctx);
    ctx.lastComponent = component;
    assert.doesNotMatch(display(component).join("\n"), /changed|last block/);
    options.isPartial = false;
    component = render(result, options, theme, ctx);
    ctx.lastComponent = component;
    assert.match(display(component).join("\n"), /last block/);
    const colors = theme.fgAnsi ?? theme.fgColors;
    const key = CONFIG.tools.general.outputColor;
    const previous = colors.get(key);
    const before = component.render(80).join("\n");
    try {
      colors.set(key, "\x1b[31m");
      component.invalidate();
      component = render(result, options, theme, ctx);
      assert.notEqual(component.render(80).join("\n"), before, `${name} must refresh an in-place theme change`);
    } finally { colors.set(key, previous); }
  }
});

test("expanded Read retains Markdown width cache across display refresh and collapse", () => {
  const component = tool("read", extension.tools.get("read").definition);
  try {
    component.updateArgs({ path: "cache.md" });
    const result = { content: [{ type: "text", text: "# First\n\nMarkdown body" }], details: {} };
    component.updateResult(result, false);
    component.setExpanded(true);
    const markdown = component.resultRendererComponent;
    const rows = markdown.render(80);
    component.updateResult(result, false);
    assert.equal(component.resultRendererComponent, markdown, "display refresh must retain MarkdownResult");
    assert.equal(markdown.render(80), rows, "retained MarkdownResult must retain rendered width cache");
    component.setExpanded(false);
    component.setExpanded(true);
    assert.equal(component.resultRendererComponent, markdown, "collapse must not discard expanded Markdown cache");
    assert.equal(markdown.render(80), rows);
    assert.notEqual(markdown.render(30), rows);
    markdown.invalidate();
    assert.notEqual(markdown.render(80), rows);
    result.content[0].text = "# Updated\n\nnew content";
    component.updateResult(result, false);
    assert.match(display(component).join("\n"), /Updated|new content/);
    assert.doesNotMatch(display(component).join("\n"), /First|Markdown body/);
    const colors = theme.fgAnsi ?? theme.fgColors;
    const previous = colors.get("mdHeading");
    const before = component.render(80).join("\n");
    try {
      colors.set("mdHeading", "\x1b[31m");
      component.invalidate();
      assert.notEqual(component.render(80).join("\n"), before);
    } finally { colors.set("mdHeading", previous); }
  } finally { finishTool(component); }
});

test("collapsed Read invalidation refreshes retained Markdown after in-place theme changes", () => {
  const component = tool("read", extension.tools.get("read").definition);
  const colors = theme.fgAnsi ?? theme.fgColors;
  const previous = colors.get("mdHeading");
  try {
    component.updateArgs({ path: "theme.md" });
    component.updateResult({ content: [{ type: "text", text: "# Heading" }], details: {} }, false);
    component.setExpanded(true);
    const markdown = component.resultRendererComponent;
    const before = markdown.render(80).join("\n");
    component.setExpanded(false);
    colors.set("mdHeading", "\x1b[31m");
    component.invalidate();
    component.setExpanded(true);
    assert.equal(component.resultRendererComponent, markdown);
    assert.notEqual(markdown.render(80).join("\n"), before, "detached Markdown must observe native theme invalidation");
  } finally {
    colors.set("mdHeading", previous);
    finishTool(component);
  }
});

test("Bash spinner ticks do not scan output lines, and native invalidation refreshes theme", () => {
  const component = new pi.BashExecutionComponent("large output", ui);
  const colors = theme.fgAnsi ?? theme.fgColors;
  const color = CONFIG.tools.general.outputColor;
  const previous = colors.get(color);
  let reads = 0;
  const lines = new Proxy(Array.from({ length: 200 }, (_, i) => `line-${i}`), {
    get(target, key, receiver) {
      if (/^\d+$/.test(String(key))) reads++;
      return Reflect.get(target, key, receiver);
    },
  });
  try {
    component.outputLines = lines;
    component.setExpanded(true);
    const before = component.render(80).join("\n");
    reads = 0;
    for (let i = 0; i < 10; i++) { component._spinnerFrame++; component.updateDisplay(); }
    assert.ok(reads <= 10, `spinner may only check the last line, not rescan all output: ${reads} reads`);
    colors.set(color, "\x1b[31m");
    component.invalidate();
    assert.notEqual(component.render(80).join("\n"), before);
    component.appendOutput(" same-line");
    assert.match(display(component).join("\n"), /line-199 same-line/);
    component.setComplete(0, false);
    assert.match(display(component).join("\n"), /160 lines above/);
  } finally { colors.set(color, previous); component.setComplete(0, false); }
});

test("cached output respects trimming changes and context truncation flags", async () => {
  // The Pi loader uses moduleCache:false; direct renderer imports share this CONFIG.
  const { renderBashResult } = await jiti.import(join(extensionDir, "components/base-renderer.ts"));
  const previous = CONFIG.tools.general.maxExpandedLines;
  const component = new pi.BashExecutionComponent("truncate", ui);
  const ctx = resultContext();
  const options = { expanded: true, isPartial: false };
  const result = { content: [{ type: "text", text: "first\nsecond\nthird\nfourth" }], details: {} };
  try {
    ctx.lastComponent = renderBashResult(result, options, theme, ctx);
    CONFIG.tools.general.maxExpandedLines = 2;
    ctx.lastComponent = renderBashResult(result, options, theme, ctx);
    assert.match(display(ctx.lastComponent).join("\n"), /2 lines above/);
    assert.doesNotMatch(display(ctx.lastComponent).join("\n"), /first|second/);
    CONFIG.tools.general.maxExpandedLines = 0;
    ctx.lastComponent = renderBashResult(result, options, theme, ctx);
    assert.match(display(ctx.lastComponent).join("\n"), /first/);
    component.setComplete(0, false);
    component.setExpanded(true);
    component.outputLines = Array.from({ length: pi.DEFAULT_MAX_LINES + 1 }, (_, i) => `context-${i}`);
    component.fullOutputPath = "/tmp/context.txt";
    assert.match(display(component).join("\n"), /Output truncated.*context\.txt/);
    component.outputLines = ["short"];
    const output = display(component).join("\n");
    assert.match(output, /short/);
    assert.doesNotMatch(output, /Output truncated|context-/);
  } finally { CONFIG.tools.general.maxExpandedLines = previous; component.setComplete(0, false); }
});

test("retained Markdown derives live indent width after prefix config changes", async () => {
  const { createMarkdownResult } = await jiti.import(join(extensionDir, "components/markdown-result.ts"));
  const previous = CONFIG.tools.toolBranch.prefix;
  try {
    const component = createMarkdownResult("", "ABCDEFGH", mdTheme, "head-tail", theme, true);
    component.render(10);
    CONFIG.tools.toolBranch.prefix = ">>>>>";
    component.invalidate();
    assert.deepEqual(display(component, 10).map((row) => row.trim()).filter(Boolean), ["ABCD", "EFGH"]);
    CONFIG.tools.toolBranch.prefix = ">";
    assert.deepEqual(display(component, 10).map((row) => row.trim()).filter(Boolean), ["ABCDEFGH"],
      "runtime indent change must also invalidate the same-width result cache");
    assertFits(component, 10);
  } finally { CONFIG.tools.toolBranch.prefix = previous; }
});

test("Read output cache observes in-place image/text/image transitions and counts", () => {
  const render = extension.tools.get("read").definition.renderResult;
  const ctx = resultContext({ expanded: false });
  const options = { expanded: false, isPartial: false };
  const result = { content: [{ type: "image", data: "", mimeType: "image/png" }], details: {} };
  ctx.lastComponent = render(result, options, theme, ctx);
  assert.match(display(ctx.lastComponent).join("\n"), /1 image/);
  result.content[0] = { type: "text", text: "one\n\ntwo" };
  ctx.lastComponent = render(result, options, theme, ctx);
  assert.match(display(ctx.lastComponent).join("\n"), /2 lines/);
  assert.doesNotMatch(display(ctx.lastComponent).join("\n"), /image/);
  result.content.splice(0, 1, { type: "image", data: "", mimeType: "image/png" },
    { type: "image", data: "", mimeType: "image/png" });
  ctx.lastComponent = render(result, options, theme, ctx);
  assert.match(display(ctx.lastComponent).join("\n"), /2 images/);
  assert.doesNotMatch(display(ctx.lastComponent).join("\n"), /lines/);
  ctx.isError = true;
  ctx.lastComponent = render(result, options, theme, ctx);
  assert.match(display(ctx.lastComponent).join("\n"), /Error.*2 images/);
});

test("shared text gathering retains every block and blank line", () => {
  assert.equal(shared.getFirstTextContent({ content: [
    { type: "text", text: "first\n\n" }, { type: "image", data: "", mimeType: "image/png" },
    { type: "text", text: "" }, { type: "text", text: "second\n\nthird" },
  ] }), "first\n\n\n\nsecond\n\nthird");
});

test("expanded fallback output retains multiple text blocks and blank rows", () => {
  const component = fallback.renderFallbackResult("unknown", { content: [
    { type: "text", text: "first\n\nsecond" }, { type: "text", text: "third" },
  ] }, { expanded: true, isPartial: false }, theme, resultContext());
  const rows = display(component).map(unbranch);
  assert.ok(rows.includes("third"));
  const first = rows.indexOf("first");
  assert.deepEqual(rows.slice(first, first + 4), ["first", "", "second", "third"]);
});

test("expanded built-in text preserves all blocks and blank output rows", () => {
  for (const name of ["read", "bash", "grep", "find", "ls"]) {
    const definition = extension.tools.get(name).definition;
    const component = definition.renderResult({ content: [
      { type: "text", text: "first\n\nsecond" }, { type: "text", text: "third" },
    ], details: {} }, { expanded: true, isPartial: false }, theme, resultContext());
    const rows = display(component).map(unbranch);
    const first = rows.indexOf("first");
    assert.deepEqual(rows.slice(first, first + 4), ["first", "", "second", "third"], name);
  }
});

test("image-only fallback reports an image rather than silent Done", () => {
  const component = fallback.renderFallbackResult("image-tool", { content: [
    { type: "image", data: "", mimeType: "image/png" },
  ] }, { expanded: false, isPartial: false }, theme, resultContext({ expanded: false }));
  assert.match(display(component).join("\n"), /image/i);
});

test("image-only fallback errors retain failure status", () => {
  const component = fallback.renderFallbackResult("image-tool", { content: [
    { type: "image", data: "", mimeType: "image/png" },
  ] }, { expanded: false, isPartial: false }, theme, resultContext({ expanded: false, isError: true }));
  const output = display(component).join("\n");
  assert.match(output, /Error/);
  assert.match(output, /image/i);
  assert.doesNotMatch(output, /Done/);
});

test("terminal width measures CJK, combining marks, emoji and ANSI hyperlinks", () => {
  for (const [text, want] of [["界", 2], ["e\u0301", 1], ["👩‍💻", 2], ["\x1b[31m界\x1b[0m", 2],
    ["\x1b]8;;https://example.invalid\x07界\x1b]8;;\x07", 2]]) {
    assert.equal(utils.getVisibleWidth(text), want, JSON.stringify(text));
  }
});

test("native patched message and tool rows fit narrow terminals", () => {
  const answer = new pi.AssistantMessageComponent(assistant([{ type: "text", text: "界👩‍💻 answer" }]), false, mdTheme);
  const question = new pi.UserMessageComponent("界👩‍💻 question", mdTheme);
  const component = tool("read", extension.tools.get("read").definition);
  const bash = new pi.BashExecutionComponent("echo 界👩‍💻", ui);
  try {
    component.updateArgs({ path: "界👩‍💻.txt" });
    component.updateResult({ content: [{ type: "text", text: "界👩‍💻 output" }], details: {} }, false);
    component.setExpanded(true);
    bash.setComplete(0, false);
    for (const width of [0, 1, 2, 3, 8, 16]) {
      for (const message of [answer, question, component, bash]) assertFits(message, width);
    }
  } finally {
    finishTool(component);
    bash.setComplete(0, false);
  }
});

test("visible thinking label also fits a narrow row", async () => {
  const { createThinkingMessage } = await jiti.import(join(extensionDir, "components/thinking-message.ts"));
  const previous = CONFIG.thinkingMessage.isLabelVisible;
  try {
    CONFIG.thinkingMessage.isLabelVisible = true;
    const component = createThinkingMessage("thought 界", mdTheme);
    for (const width of [1, 2, 8, 16]) assertFits(component, width);
  } finally { CONFIG.thinkingMessage.isLabelVisible = previous; }
});

test("custom expanded details and skill content remain visible after narrow layout", async () => {
  const { createCustomMessage } = await jiti.import(join(extensionDir, "components/custom-message.ts"));
  const { createSkillInvocationMessage } = await jiti.import(join(extensionDir, "components/skill-message.ts"));
  const custom = createCustomMessage("custom", "body", { title: "title", note: "details" }, mdTheme);
  const skill = createSkillInvocationMessage("skill", "body", mdTheme);
  custom.setExpanded(true);
  skill.setExpanded(true);
  assert.match(display(custom, 24).join("\n"), /details/);
  assert.match(display(skill, 24).join("\n"), /body/);
  assertFits(custom, 24);
  assertFits(skill, 24);
});

for (const [file, factory, args] of [
  ["assistant-message", "createAssistantMessage", ["界 e\u0301 👩‍💻 long answer"]],
  ["thinking-message", "createThinkingMessage", ["界 e\u0301 👩‍💻 long thought"]],
  ["user-message", "createUserMessage", ["界 e\u0301 👩‍💻 long question"]],
  ["custom-message", "createCustomMessage", ["long-custom-title-界👩‍💻", "body 界 body", { title: "very long title 界👩‍💻", long: "details 界👩‍💻" }]],
  ["skill-message", "createSkillInvocationMessage", ["long-skill-title-界👩‍💻", "body 界 body"]],
]) {
  test(`${file} rows fit narrow terminal widths, including expanded details`, async () => {
    const module = await jiti.import(join(extensionDir, `components/${file}.ts`));
    const component = module[factory](...args, mdTheme);
    for (const expanded of [false, true]) {
      component.setExpanded?.(expanded);
      for (const width of [0, 1, 2, 3, 8, 16, 32]) assertFits(component, width);
    }
  });
}

// --- Claude Code style ---

const HINT = String.raw`\(\S+ to expand\)`;
const rows = (component) => display(component).map((row) => row.trimEnd()).join("\n");
function renderTool(name, args, result, { expanded = false, isError = false } = {}) {
  const definition = extension.tools.get(name).definition;
  const ctx = resultContext({ args, expanded, isError });
  const header = rows(definition.renderCall(args, theme, ctx));
  const body = rows(definition.renderResult(result, { expanded, isPartial: false }, theme, ctx));
  return { header, body };
}
const textResult = (text, details = {}) => ({ content: [{ type: "text", text }], details });

test("tool headers use Claude Code Tool(args) format with a filled dot", () => {
  assert.match(renderTool("read", { path: "src/foo.ts" }, textResult("a")).header, /● Read\(src\/foo\.ts\)/);
  assert.match(renderTool("bash", { command: "npm test" }, textResult("ok")).header, /● Bash\(npm test\)/);
  assert.match(renderTool("edit", { path: "src/foo.ts", edits: [] }, textResult("ok")).header, /● Update\(src\/foo\.ts\)/);
  assert.match(renderTool("write", { path: "src/foo.ts", content: "x" }, textResult("ok")).header, /● Write\(src\/foo\.ts\)/);
  assert.match(renderTool("grep", { pattern: "foo", path: "src" }, textResult("a")).header, /● Search\(pattern: "foo", path: "src"\)/);
  assert.match(renderTool("grep", { pattern: "foo" }, textResult("a")).header, /● Search\(pattern: "foo"\)$/m);
  assert.match(renderTool("find", { pattern: "*.ts", path: "src" }, textResult("a")).header, /● Search\(pattern: "\*\.ts", path: "src"\)/);
  assert.match(renderTool("ls", { path: "src" }, textResult("a")).header, /● List\(src\)/);
  assert.match(display(fallback.renderFallbackCall("mcp_tool", { query: "hello" }, theme, resultContext())).join("\n"), /● mcp_tool\(hello\)/);
});

test("tool status lines use the ⎿ branch and Claude Code wording", () => {
  assert.match(renderTool("read", { path: "a.ts" }, textResult("a\nb\nc")).body, new RegExp(`⎿  Read 3 lines ${HINT}`));
  assert.match(renderTool("read", { path: "a.ts" }, textResult("a")).body, /⎿  Read 1 line\b/);
  assert.match(renderTool("grep", { pattern: "x" }, textResult("a:1:x\nb:2:x")).body, new RegExp(`⎿  Found 2 matches ${HINT}`));
  assert.match(renderTool("grep", { pattern: "x" }, textResult("No matches found")).body, /⎿  No matches found/);
  assert.match(renderTool("find", { pattern: "x" }, textResult("a.ts\nb.ts\nc.ts")).body, new RegExp(`⎿  Found 3 files ${HINT}`));
  assert.match(renderTool("ls", { path: "." }, textResult("a\nb/")).body, new RegExp(`⎿  Listed 2 paths ${HINT}`));
  assert.match(renderTool("read", { path: "a.ts" }, textResult("ENOENT: no such file"), { isError: true }).body, /⎿  Error: ENOENT: no such file/);
});

test("collapsed Bash and fallback results preview the first lines like Claude Code", () => {
  const text = "l1\nl2\nl3\nl4\nl5";
  for (const body of [
    renderTool("bash", { command: "x" }, textResult(text)).body,
    rows(fallback.renderFallbackResult("t", textResult(text), { expanded: false, isPartial: false }, theme, resultContext({ expanded: false }))),
  ]) {
    assert.match(body, /⎿  l1\n\s+l2\n\s+l3\n\s+… \+2 lines \(\S+ to expand\)/);
    assert.doesNotMatch(body, /l4|l5/);
  }
  assert.match(renderTool("bash", { command: "x" }, textResult("one\ntwo")).body, /⎿  one\n\s+two$/);
  assert.doesNotMatch(renderTool("bash", { command: "x" }, textResult("one\ntwo")).body, /expand/);
  assert.match(renderTool("bash", { command: "x" }, textResult("(no output)")).body, /⎿  \(No content\)/);
  const failed = renderTool("bash", { command: "x" }, textResult("boom\nCommand exited with code 2"), { isError: true }).body;
  assert.match(failed, /⎿  Error: Exit 2\n\s+boom/);
});

test("Edit shows the Claude Code summary and diff without expanding", () => {
  const diff = "  1 keep\n-2 old\n+2 new\n+3 extra";
  const { body } = renderTool("edit", { path: "src/foo.ts", edits: [{}] }, textResult("ok", { diff }));
  assert.match(body, /⎿  Updated src\/foo\.ts with 2 additions and 1 removal/);
  assert.match(body, /-2 old/);
  assert.match(body, /\+3 extra/);
});

test("Write shows the Claude Code summary and a content preview", () => {
  const { body } = renderTool("write", { path: "src/foo.ts", content: "a\nb\nc\nd\ne" }, textResult("ok"));
  assert.match(body, /⎿  Wrote 5 lines to src\/foo\.ts\n\s+a\n\s+b\n\s+c\n\s+… \+2 lines \(\S+ to expand\)/);
  const expanded = renderTool("write", { path: "src/foo.ts", content: "a\nb\nc\nd\ne" }, textResult("ok"), { expanded: true }).body;
  assert.match(expanded, /\n\s+e$/m);
});

test("user ! commands render as ! cmd with a ⎿ output preview", () => {
  const component = new pi.BashExecutionComponent("ls", ui, false);
  try {
    component.appendOutput("a\nb\nc\nd");
    component.setComplete(0, false);
    const output = rows(component);
    assert.match(output, /! ls/);
    assert.match(output, /⎿  a\n\s+b\n\s+c\n\s+… \+1 lines? \(\S+ to expand\)/);
  } finally { component.setComplete(0, false); }
});

test("skill and custom messages use the Claude Code header and branch", async () => {
  const { createCustomMessage } = await jiti.import(join(extensionDir, "components/custom-message.ts"));
  const { createSkillInvocationMessage } = await jiti.import(join(extensionDir, "components/skill-message.ts"));
  const skill = display(createSkillInvocationMessage("brainstorm", "body", mdTheme)).join("\n");
  assert.match(skill, new RegExp(`● Skill\\(brainstorm\\)\\n\\s*⎿  Loaded ${HINT}`));
  const custom = display(createCustomMessage("note", "body", undefined, mdTheme)).join("\n");
  assert.match(custom, new RegExp(`● note\\n\\s*⎿  Done ${HINT}`));
});

test("thinking renders a ✻ Thinking… header line above the thought", async () => {
  const { createThinkingMessage } = await jiti.import(join(extensionDir, "components/thinking-message.ts"));
  const rows = display(createThinkingMessage("deep thought", mdTheme));
  const header = rows.findIndex((row) => /✻ Thinking…/.test(row));
  assert.ok(header >= 0, rows.join("\n"));
  assert.doesNotMatch(rows[header], /deep thought/);
  assert.ok(rows.slice(header + 1).some((row) => /deep thought/.test(row)));
});

test("user messages use the > prompt prefix", () => {
  assert.match(display(new pi.UserMessageComponent("hello", mdTheme, 1)).join("\n"), /> hello/);
});

test("paths inside the working directory render relative, like Claude Code", () => {
  const home = process.env.HOME;
  assert.equal(utils.shortenPath(join(home, "proj/src/a.ts"), join(home, "proj")), "src/a.ts");
  assert.equal(utils.shortenPath(join(home, "other/b.ts"), join(home, "proj")), "~/other/b.ts");
  assert.equal(utils.shortenPath("/etc/hosts", join(home, "proj")), "/etc/hosts");
});

test("collapsed output skips leading blank rows so the branch never sits empty", () => {
  const body = renderTool("bash", { command: "x" }, textResult("\n\nfoo\nbar")).body;
  assert.match(body, /⎿  foo\n\s+bar/);
  const component = new pi.BashExecutionComponent("blank lead", ui, false);
  try {
    component.appendOutput("\nfoo\nbar");
    component.setComplete(0, false);
    assert.match(rows(component), /⎿  foo\n\s+bar/);
  } finally { component.setComplete(0, false); }
});

test("assistant and thinking bodies align one space after their prefix, like tool titles", () => {
  const answer = display(new pi.AssistantMessageComponent(assistant([{ type: "text", text: "hello there" }]), false, mdTheme));
  assert.ok(answer.some((row) => /^ ● hello there/.test(row)), answer.join("\n"));
  const thought = display(new pi.AssistantMessageComponent(assistant([{ type: "thinking", thinking: "deep thought" }]), false, mdTheme));
  assert.ok(thought.some((row) => /^ {3}deep thought/.test(row)), thought.join("\n"));
});
