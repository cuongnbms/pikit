import { Markdown } from "@earendil-works/pi-tui";
import { CONFIG } from "../config.js";
import { getVisibleWidth, currentTheme, applyColor, getExpandToggleKey, fitLineToWidth, wrapAnsiToWidth } from "../utils.js";
import { branchLine, indentLine } from "./tool-shared.js";

const BRANCH_INDENT_WIDTH = getVisibleWidth(CONFIG.tools.toolBranch.prefix) + 1;
const HPAD = () => CONFIG.tools.general.horizontalPadding;
const VPAD = () => CONFIG.tools.general.verticalPadding;

export interface CustomMessageRenderable {
  setExpanded(value: boolean): void;
  invalidate(): void;
  render(width: number): string[];
}

export function createCustomMessage(
  customType: string,
  content: string,
  details: unknown,
  markdownTheme: any,
): CustomMessageRenderable {
  const md = new Markdown(content, 0, 0, markdownTheme);
  let expanded = false;
  let cachedWidth: number | undefined;
  let cachedExpanded: boolean | undefined;
  let cachedLines: string[] | undefined;

  function setExpanded(value: boolean): void {
    if (expanded !== value) {
      expanded = value;
      invalidate();
    }
  }

  function invalidate(): void {
    cachedWidth = undefined;
    cachedExpanded = undefined;
    cachedLines = undefined;
    md.invalidate();
  }

  function innerWidth(width: number): number {
    if (width <= 0) return 0;
    const hpad = Math.min(HPAD(), Math.max(0, width - 1));
    return Math.max(0, width - hpad);
  }

  function addPadding(lines: string[], width: number): string[] {
    if (width <= 0) return lines.map(() => "");
    const hpad = Math.min(HPAD(), Math.max(0, width - 1));
    const vpad = VPAD();
    const pad = " ".repeat(hpad);
    const contentWidth = Math.max(0, width - hpad);
    const out: string[] = [];
    for (let i = 0; i < vpad; i++) out.push("");
    for (const line of lines) {
      for (const wrapped of wrapAnsiToWidth(line, contentWidth)) {
        out.push(fitLineToWidth(pad + wrapped, width));
      }
    }
    for (let i = 0; i < vpad; i++) out.push("");
    return out;
  }

  function render(width: number): string[] {
    if (cachedLines && cachedWidth === width && cachedExpanded === expanded) return cachedLines;

    const t = currentTheme!;
    const contentWidth = innerWidth(width);

    // Line 1: " ● Custom tool  custom-type-name"
    const dot = applyColor(t, CONFIG.customMessages.prefixColor, CONFIG.customMessages.prefix);
    const label = applyColor(t, CONFIG.customMessages.titleColor, t.bold("Custom tool"));
    const displayName = (details && typeof details === 'object' && 'title' in details && typeof (details as any).title === 'string')
      ? (details as any).title
      : customType;
    const name = applyColor(t, CONFIG.customMessages.nameColor, displayName);
    const header = `${dot} ${label} ${name}`;

    // Line 2: branch + status
    const loaded = applyColor(t, CONFIG.customMessages.labelColor, "Done");

    if (!expanded) {
      cachedWidth = width;
      cachedExpanded = expanded;
      const hint = applyColor(t, CONFIG.customMessages.expandHintColor, ` • ${getExpandToggleKey()} to expand`);
      cachedLines = addPadding(["", header, branchLine(loaded, t) + hint], width);
      return cachedLines;
    }

    // Expanded: header + branch + indented markdown content
    const lines: string[] = ["", header, branchLine(loaded, t)];

    if (contentWidth > BRANCH_INDENT_WIDTH) {
      const mdLines = md.render(Math.max(1, contentWidth - BRANCH_INDENT_WIDTH));
      for (const line of mdLines) {
        lines.push(indentLine(applyColor(t, CONFIG.customMessages.outputColor, line)));
      }
    }

    // Render details as pretty-printed JSON if present
    if (details !== undefined && details !== null) {
      try {
        const json = JSON.stringify(details, null, 2);
        for (const line of json.split("\n")) {
          lines.push(indentLine(applyColor(t, CONFIG.customMessages.outputColor, line)));
        }
      } catch {
        // Skip non-serializable details
      }
    }

    cachedWidth = width;
    cachedExpanded = expanded;
    cachedLines = addPadding(lines, width);
    return cachedLines;
  }

  return { setExpanded, invalidate, render };
}