import { Text } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { CONFIG } from "../config.js";
import type { TrimStrategy } from "../types.js";
import { applyColor, applyBgColor, toolPrefix, errorPrefix, getVisibleWidth, getExpandToggleKey } from "../utils.js";

// --- Group-aware config resolution ---

type GeneralConfigKey = keyof typeof CONFIG.tools.general;

export function groupProp<K extends GeneralConfigKey>(
  group: keyof typeof CONFIG.tools.groups,
  prop: K,
): (typeof CONFIG.tools.general)[K] {
  const val = (CONFIG.tools.groups[group] as any)?.[prop];
  return val !== undefined ? val : CONFIG.tools.general[prop];
}

export function groupTitleColor(group: keyof typeof CONFIG.tools.groups): string {
  return groupProp(group, "titleColor");
}

// --- Text component helper ---

export function makeText(lastComponent: Text | undefined, text: string): Text {
  if (!(lastComponent instanceof Text)) return new Text(text, 0, 0);
  // Compare the native value, not a side cache: callers may also use setText().
  // Native invalidate() remains untouched, even when the string is unchanged.
  if ((lastComponent as any).text !== text) lastComponent.setText(text);
  return lastComponent;
}

// --- Spinner ---

const SPINNER_CHARS = CONFIG.tools.toolSpinnerPrefix.prefixChars;
const SPINNER_FRAMES = [...SPINNER_CHARS, ...[...SPINNER_CHARS].reverse()];
const SPINNER_INTERVAL = 80;
const SPINNER_STATE = Symbol.for("styled-outputs:tool-spinners");
const spinnerState: { states: Set<any>; generation: number; active: boolean } =
  (globalThis as any)[SPINNER_STATE] ??= { states: new Set(), generation: 0, active: false };

export function stopToolSpinners(): void {
  spinnerState.active = false;
  for (const state of spinnerState.states) {
    clearInterval(state.spinnerInterval);
    state.spinnerInterval = undefined;
  }
  spinnerState.states.clear();
}

export function startToolSpinnerSession(): void {
  stopToolSpinners();
  spinnerState.generation++;
  spinnerState.active = true;
}

export function ensureSpinner(ctx: any): number {
  ctx.state.spinnerGeneration ??= spinnerState.generation;
  if (!spinnerState.active || ctx.state.spinnerGeneration !== spinnerState.generation) return ctx.state.spinnerFrame ?? 0;
  if (ctx.state.spinnerInterval) return ctx.state.spinnerFrame ?? 0;
  ctx.state.spinnerFrame = 0;
  const timer = setInterval(() => {
    if (!spinnerState.active || ctx.state.spinnerInterval !== timer) return;
    ctx.state.spinnerFrame = (ctx.state.spinnerFrame + 1) % SPINNER_FRAMES.length;
    ctx.invalidate();
  }, SPINNER_INTERVAL);
  ctx.state.spinnerInterval = timer;
  spinnerState.states.add(ctx.state);
  return 0;
}

export function clearSpinner(ctx: any) {
  if (ctx.state.spinnerInterval) {
    clearInterval(ctx.state.spinnerInterval);
    ctx.state.spinnerInterval = undefined;
  }
  spinnerState.states.delete(ctx.state);
}

export function spinnerDot(theme: Theme, frame: number): string {
  return `${applyColor(theme, CONFIG.tools.toolSpinnerPrefix.color, SPINNER_FRAMES[frame % SPINNER_FRAMES.length])} `;
}

// --- Header / status / output helpers ---

export function toolHeader(label: string, summary: string, theme: Theme, dot?: string, isError?: boolean, titleColor?: string): string {
  const d = dot ?? (isError ? errorPrefix(theme) : toolPrefix(theme));
  const color = titleColor ?? CONFIG.tools.general.titleColor;
  const title = applyColor(theme, color, theme.bold(label));
  return `${d}${title} ${summary}`;
}

export function branchLine(text: string, theme: Theme): string {
  const icon = applyColor(theme, CONFIG.tools.toolBranch.color, CONFIG.tools.toolBranch.prefix);
  return `${icon} ${text}`;
}

export function indentLine(text: string): string {
  return `${" ".repeat(getVisibleWidth(CONFIG.tools.toolBranch.prefix) + 1)}${text}`;
}

export function expandHint(theme: Theme): string {
  return applyColor(theme, CONFIG.tools.general.expandHintColor, ` • ${getExpandToggleKey()} to expand`);
}

const NO_OUTPUT_PLACEHOLDER = "(no output)";

export function outputLines(text: string): string[] {
  if (text === NO_OUTPUT_PLACEHOLDER) return [];
  return text.split("\n");
}

export function getFirstTextContent(result: any): string {
  if (!Array.isArray(result?.content)) return "";
  const blocks: string[] = [];
  for (const block of result.content) {
    if (block?.type === "text" && typeof block.text === "string") blocks.push(block.text);
  }
  return blocks.join("\n");
}

export function getImageContentCount(result: any): number {
  if (!Array.isArray(result?.content)) return 0;
  return result.content.filter((block: any) => block?.type === "image").length;
}

export function renderSuppressedPartial(ctx: any): Text {
  return makeText(ctx.lastComponent, "");
}

export function errorLabel(theme: Theme): string {
  return branchLine(applyColor(theme, CONFIG.tools.toolError.labelColor, "Error"), theme);
}

export function renderPartial(theme: Theme): string {
  return branchLine(applyColor(theme, CONFIG.tools.general.outputColor, "Running..."), theme);
}

export function doneLabel(theme: Theme, count?: { label: string; value: number }): string {
  const done = applyColor(theme, CONFIG.tools.toolSuccess.labelColor, "Done");
  const text = count
    ? `${done}${applyColor(theme, CONFIG.tools.general.expandHintColor, " • ")}${applyColor(theme, CONFIG.tools.general.countColor, `${count.value} ${count.label}`)}`
    : done;
  return branchLine(text, theme);
}

// --- Expanded output trimming ---

export function formatExpandedLines(lines: string[], strategy: TrimStrategy, theme: Theme): string {
  const max = CONFIG.tools.general.maxExpandedLines;

  if (max < 1 || lines.length <= max) {
    return lines.map(l => "\n" + indentLine(l)).join("");
  }

  const more = (count: number, label: string) => {
    const text = applyColor(theme, CONFIG.tools.general.moreColor, `─── ${count} ${label} ───`);
    const withBg = applyBgColor(theme, CONFIG.tools.general.moreBgColor || undefined, text);
    return indentLine(withBg);
  };
  const half = Math.floor(max / 2);

  switch (strategy) {
    case "head":
      return lines.slice(0, max).map(l => "\n" + indentLine(l)).join("")
        + "\n" + more(lines.length - max, "more lines");

    case "tail": {
      const hidden = lines.length - max;
      return "\n" + more(hidden, "lines above")
        + lines.slice(-max).map(l => "\n" + indentLine(l)).join("");
    }

    case "head-tail": {
      const hidden = lines.length - max;
      return lines.slice(0, half).map(l => "\n" + indentLine(l)).join("")
        + "\n" + more(hidden, "more lines")
        + lines.slice(-half).map(l => "\n" + indentLine(l)).join("");
    }
  }
}