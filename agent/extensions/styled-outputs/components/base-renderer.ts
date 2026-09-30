import type { Component } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { renderDiff, getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { CONFIG } from "../config.js";
import { applyColor, shortenPath } from "../utils.js";
import {
  makeText, toolHeader, branchLine, expandHint,
  errorLabel, renderPartial, doneLabel,
  ensureSpinner, clearSpinner, spinnerDot, groupTitleColor,
  formatExpandedLines, renderSuppressedPartial,
} from "./tool-shared.js";
import { createMarkdownResult, type MarkdownResult } from "./markdown-result.js";
import { getResultOutput, cachedExpandedLines } from "./output-cache.js";

// Retain the expanded document while the native tool switches to a collapsed Text.
const READ_MARKDOWN = Symbol.for("styled-outputs:read-markdown");
interface ReadMarkdownCache { text: string; label: string; component: MarkdownResult }

export function invalidateStyledResults(state: any): void {
  // Native Container.invalidate() only sees the currently attached (possibly
  // collapsed) result. The symbol also connects prototype hooks to reloaded renderers.
  (state?.[READ_MARKDOWN] as ReadMarkdownCache | undefined)?.component.invalidate();
}

const BASE_TITLE_COLOR = groupTitleColor("base");

// --- Read tool ---

export function renderReadCall(args: any, theme: Theme, ctx: any): Component {
  const path = shortenPath(args.file_path ?? args.path ?? "", ctx.cwd ?? process.cwd());
  const summary = applyColor(theme, CONFIG.tools.general.summaryColor, path);
  if (ctx.isPartial) {
    const frame = ensureSpinner(ctx);
    return makeText(ctx.lastComponent, toolHeader("Read", summary, theme, spinnerDot(theme, frame), undefined, BASE_TITLE_COLOR) + "\n" + renderPartial(theme));
  }
  clearSpinner(ctx);
  return makeText(ctx.lastComponent, toolHeader("Read", summary, theme, undefined, ctx.isError, BASE_TITLE_COLOR));
}

export function renderReadResult(result: any, options: { expanded: boolean; isPartial: boolean }, theme: Theme, ctx: any): Component {
  if (options.isPartial || ctx.isPartial) return renderSuppressedPartial(ctx);

  const { text, images, hasText, lines, nonEmptyLines } = getResultOutput(result, ctx);
  if (!hasText && images > 0) {
    const count = { label: images === 1 ? "image" : "images", value: images };
    const status = ctx.isError
      ? errorLabel(theme) + applyColor(theme, CONFIG.tools.general.countColor, ` • ${images} ${count.label}`)
      : doneLabel(theme, count);
    return makeText(ctx.lastComponent, status);
  }

  if (ctx.isError) {
    if (!options.expanded) {
      return makeText(ctx.lastComponent, errorLabel(theme) + expandHint(theme));
    }
    return makeText(ctx.lastComponent, errorLabel(theme) + cachedExpandedLines(lines, "tail", theme));
  }
  const count = nonEmptyLines.length > 0 ? { label: "lines", value: nonEmptyLines.length } : undefined;

  if (!options.expanded) {
    return makeText(ctx.lastComponent, doneLabel(theme, count) + (nonEmptyLines.length > 0 ? expandHint(theme) : ""));
  }

  // Use MarkdownResult for .md files
  const filePath = ctx.args?.file_path ?? ctx.args?.path ?? "";
  if (filePath.endsWith(".md")) {
    const label = doneLabel(theme, count);
    const cached = ctx.state[READ_MARKDOWN] as ReadMarkdownCache | undefined;
    if (cached && cached.text === text && cached.label === label) return cached.component;
    const component = createMarkdownResult(label, text, getMarkdownTheme(), "head-tail", theme, true);
    ctx.state[READ_MARKDOWN] = { text, label, component } satisfies ReadMarkdownCache;
    return component;
  }

  return makeText(ctx.lastComponent, doneLabel(theme, count) + cachedExpandedLines(lines, "head-tail", theme));
}

// --- Grep tool ---

export function renderGrepCall(args: any, theme: Theme, ctx: any): Component {
  const pattern = args.pattern ?? "";
  const searchPath = shortenPath(args.path ?? ".", ctx.cwd ?? process.cwd());
  let summary = applyColor(theme, CONFIG.tools.general.summaryColor, `${pattern} in ${searchPath}`);
  if (args.glob) summary += applyColor(theme, CONFIG.tools.general.outputColor, ` (${args.glob})`);
  if (ctx.isPartial) {
    const frame = ensureSpinner(ctx);
    return makeText(ctx.lastComponent, toolHeader("Grep", summary, theme, spinnerDot(theme, frame), undefined, BASE_TITLE_COLOR) + "\n" + renderPartial(theme));
  }
  clearSpinner(ctx);
  return makeText(ctx.lastComponent, toolHeader("Grep", summary, theme, undefined, ctx.isError, BASE_TITLE_COLOR));
}

export function renderGrepResult(result: any, options: { expanded: boolean; isPartial: boolean }, theme: Theme, ctx: any): Component {
  if (options.isPartial || ctx.isPartial) return renderSuppressedPartial(ctx);

  const { text, lines, nonEmptyLines } = getResultOutput(result, ctx);

  if (ctx.isError) {
    if (!options.expanded) {
      return makeText(ctx.lastComponent, errorLabel(theme) + expandHint(theme));
    }
    return makeText(ctx.lastComponent, errorLabel(theme) + cachedExpandedLines(lines, "tail", theme));
  }

  const lineCount = text === "No matches found" ? 0 : nonEmptyLines.length;
  const count = lineCount > 0 ? { label: "matches", value: lineCount } : undefined;

  if (!options.expanded) {
    return makeText(ctx.lastComponent, doneLabel(theme, count) + (lineCount > 0 ? expandHint(theme) : ""));
  }

  return makeText(ctx.lastComponent, doneLabel(theme, count) + cachedExpandedLines(lines, "head", theme));
}

// --- Find tool ---

export function renderFindCall(args: any, theme: Theme, ctx: any): Component {
  const pattern = args.pattern ?? "";
  const searchPath = shortenPath(args.path ?? ".", ctx.cwd ?? process.cwd());
  let summary = applyColor(theme, CONFIG.tools.general.summaryColor, `${pattern} in ${searchPath}`);
  if (ctx.isPartial) {
    const frame = ensureSpinner(ctx);
    return makeText(ctx.lastComponent, toolHeader("Find", summary, theme, spinnerDot(theme, frame), undefined, BASE_TITLE_COLOR) + "\n" + renderPartial(theme));
  }
  clearSpinner(ctx);
  return makeText(ctx.lastComponent, toolHeader("Find", summary, theme, undefined, ctx.isError, BASE_TITLE_COLOR));
}

export function renderFindResult(result: any, options: { expanded: boolean; isPartial: boolean }, theme: Theme, ctx: any): Component {
  if (options.isPartial || ctx.isPartial) return renderSuppressedPartial(ctx);

  const { text, lines: items, nonEmptyLines: nonEmptyItems } = getResultOutput(result, ctx);

  if (ctx.isError) {
    if (!options.expanded) {
      return makeText(ctx.lastComponent, errorLabel(theme) + expandHint(theme));
    }
    return makeText(ctx.lastComponent, errorLabel(theme) + cachedExpandedLines(items, "tail", theme));
  }

  const itemCount = text === "No files found matching pattern" ? 0 : nonEmptyItems.length;
  const count = itemCount > 0 ? { label: "files", value: itemCount } : undefined;

  if (!options.expanded) {
    return makeText(ctx.lastComponent, doneLabel(theme, count) + (itemCount > 0 ? expandHint(theme) : ""));
  }

  return makeText(ctx.lastComponent, doneLabel(theme, count) + cachedExpandedLines(items, "head", theme, true));
}

// --- Bash tool ---

export function renderBashCall(args: any, theme: Theme, ctx: any): Component {
  const cmd = args.command ?? "";
  const maxPreview = 60;
  const preview = cmd.length > maxPreview ? cmd.slice(0, maxPreview) + "…" : cmd;
  const summary = applyColor(theme, CONFIG.tools.general.summaryColor, preview);
  if (ctx.isPartial) {
    const frame = ensureSpinner(ctx);
    return makeText(ctx.lastComponent, toolHeader("Bash", summary, theme, spinnerDot(theme, frame), undefined, BASE_TITLE_COLOR) + "\n" + renderPartial(theme));
  }
  clearSpinner(ctx);
  return makeText(ctx.lastComponent, toolHeader("Bash", summary, theme, undefined, ctx.isError, BASE_TITLE_COLOR));
}

export function renderBashResult(result: any, options: { expanded: boolean; isPartial: boolean }, theme: Theme, ctx: any): Component {
  if (options.isPartial || ctx.isPartial) return renderSuppressedPartial(ctx);

  const { lines, nonEmptyLines, bashError: statusText } = getResultOutput(result, ctx);

  if (ctx.isError) {
    const display = branchLine(applyColor(theme, CONFIG.tools.toolError.labelColor, statusText), theme);
    if (!options.expanded) {
      return makeText(ctx.lastComponent, display + expandHint(theme));
    }
    return makeText(ctx.lastComponent, display + cachedExpandedLines(lines, "tail", theme));
  }

  const count = nonEmptyLines.length > 0 ? { label: "lines", value: nonEmptyLines.length } : undefined;

  if (!options.expanded) {
    return makeText(ctx.lastComponent, doneLabel(theme, count) + (nonEmptyLines.length > 0 ? expandHint(theme) : ""));
  }

  return makeText(ctx.lastComponent, doneLabel(theme, count) + cachedExpandedLines(lines, "tail", theme));
}

// --- Edit tool ---

export function renderEditCall(args: any, theme: Theme, ctx: any): Component {
  const path = shortenPath(args.path ?? "", ctx.cwd ?? process.cwd());
  const operations = args.edits ?? [];
  ctx.state.editCount = operations.length;
  const summary = applyColor(theme, CONFIG.tools.general.summaryColor, path);
  if (ctx.isPartial) {
    const frame = ensureSpinner(ctx);
    return makeText(ctx.lastComponent, toolHeader("Edit", summary, theme, spinnerDot(theme, frame), undefined, BASE_TITLE_COLOR) + "\n" + renderPartial(theme));
  }
  clearSpinner(ctx);
  return makeText(ctx.lastComponent, toolHeader("Edit", summary, theme, undefined, ctx.isError, BASE_TITLE_COLOR));
}

export function renderEditResult(result: any, options: { expanded: boolean; isPartial: boolean }, theme: Theme, ctx: any): Component {
  if (options.isPartial || ctx.isPartial) return renderSuppressedPartial(ctx);

  if (ctx.isError) {
    const { lines } = getResultOutput(result, ctx);
    if (!options.expanded) {
      return makeText(ctx.lastComponent, errorLabel(theme) + expandHint(theme));
    }
    return makeText(ctx.lastComponent, errorLabel(theme) + cachedExpandedLines(lines, "tail", theme));
  }

  const editCount = (ctx.state.editCount as number | undefined) ?? 0;
  const count = editCount > 0 ? { label: `edit${editCount > 1 ? "s" : ""}`, value: editCount } : undefined;

  if (options.expanded && result.details?.diff) {
    const diffLines = renderDiff(result.details.diff).split("\n");
    return makeText(ctx.lastComponent, doneLabel(theme, count) + formatExpandedLines(diffLines, "head-tail", theme));
  }

  return makeText(ctx.lastComponent, doneLabel(theme, count));
}

// --- Write tool ---

export function renderWriteCall(args: any, theme: Theme, ctx: any): Component {
  const path = shortenPath(args.path ?? "", ctx.cwd ?? process.cwd());
  const content = args.content ?? "";
  ctx.state.lineCount = content.split("\n").length;

  const summary = applyColor(theme, CONFIG.tools.general.summaryColor, path);
  if (ctx.isPartial) {
    const frame = ensureSpinner(ctx);
    return makeText(ctx.lastComponent, toolHeader("Write", summary, theme, spinnerDot(theme, frame), undefined, BASE_TITLE_COLOR) + "\n" + renderPartial(theme));
  }
  clearSpinner(ctx);
  return makeText(ctx.lastComponent, toolHeader("Write", summary, theme, undefined, ctx.isError, BASE_TITLE_COLOR));
}

export function renderWriteResult(result: any, options: { expanded: boolean; isPartial: boolean }, theme: Theme, ctx: any): Component {
  if (options.isPartial || ctx.isPartial) return renderSuppressedPartial(ctx);

  if (ctx.isError) {
    const { lines } = getResultOutput(result, ctx);
    if (!options.expanded) {
      return makeText(ctx.lastComponent, errorLabel(theme) + expandHint(theme));
    }
    return makeText(ctx.lastComponent, errorLabel(theme) + cachedExpandedLines(lines, "tail", theme));
  }

  const lineCount = (ctx.state.lineCount as number | undefined) ?? 0;
  const count = lineCount > 0 ? { label: `line${lineCount > 1 ? "s" : ""}`, value: lineCount } : undefined;
  return makeText(ctx.lastComponent, doneLabel(theme, count));
}

// --- Ls tool ---

export function renderLsCall(args: any, theme: Theme, ctx: any): Component {
  const path = shortenPath(args.path ?? ".", ctx.cwd ?? process.cwd());
  const summary = applyColor(theme, CONFIG.tools.general.summaryColor, path);
  if (ctx.isPartial) {
    const frame = ensureSpinner(ctx);
    return makeText(ctx.lastComponent, toolHeader("ls", summary, theme, spinnerDot(theme, frame), undefined, BASE_TITLE_COLOR) + "\n" + renderPartial(theme));
  }
  clearSpinner(ctx);
  return makeText(ctx.lastComponent, toolHeader("ls", summary, theme, undefined, ctx.isError, BASE_TITLE_COLOR));
}

export function renderLsResult(result: any, options: { expanded: boolean; isPartial: boolean }, theme: Theme, ctx: any): Component {
  if (options.isPartial || ctx.isPartial) return renderSuppressedPartial(ctx);

  const { text, lines: items, nonEmptyLines: nonEmptyItems } = getResultOutput(result, ctx);

  if (ctx.isError) {
    if (!options.expanded) {
      return makeText(ctx.lastComponent, errorLabel(theme) + expandHint(theme));
    }
    return makeText(ctx.lastComponent, errorLabel(theme) + cachedExpandedLines(items, "tail", theme));
  }

  const itemCount = text === "(empty directory)" ? 0 : nonEmptyItems.length;
  const count = itemCount > 0 ? { label: "entries", value: itemCount } : undefined;

  if (!options.expanded) {
    return makeText(ctx.lastComponent, doneLabel(theme, count) + (itemCount > 0 ? expandHint(theme) : ""));
  }

  return makeText(ctx.lastComponent, doneLabel(theme, count) + cachedExpandedLines(items, "head", theme, true));
}