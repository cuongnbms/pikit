import type { Component } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { renderDiff, getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { CONFIG } from "../config.js";
import { applyColor, shortenPath } from "../utils.js";
import {
  makeText, toolHeader, expandHint, statusLine, plural, onBranch, previewLines, contentEnd, indentLine,
  errorLabel, errorResult, renderPartial,
  ensureSpinner, clearSpinner, spinnerDot, groupTitleColor,
  renderSuppressedPartial,
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

// --- Shared call rendering: "● Tool(args)", plus "⎿  Running…" while partial ---

function renderCall(label: string, summary: string, theme: Theme, ctx: any): Component {
  const args = applyColor(theme, CONFIG.tools.general.summaryColor, summary);
  if (ctx.isPartial) {
    const frame = ensureSpinner(ctx);
    return makeText(ctx.lastComponent, toolHeader(label, args, theme, spinnerDot(theme, frame), undefined, BASE_TITLE_COLOR) + "\n" + renderPartial(theme));
  }
  clearSpinner(ctx);
  return makeText(ctx.lastComponent, toolHeader(label, args, theme, undefined, ctx.isError, BASE_TITLE_COLOR));
}

function cwdOf(ctx: any): string {
  return ctx.cwd ?? process.cwd();
}

/** `pattern: "x", path: "src"` — the path is omitted when it is the working directory. */
function searchSummary(args: any, ctx: any): string {
  const parts = [`pattern: "${args.pattern ?? ""}"`];
  const searchPath = args.path ? shortenPath(args.path, cwdOf(ctx)) : ".";
  if (searchPath !== ".") parts.push(`path: "${searchPath}"`);
  if (args.glob) parts.push(`glob: "${args.glob}"`);
  return parts.join(", ");
}

/** Collapsed: status + hint when there is output; expanded: status + listed output. */
function countedResult(status: string, count: number, expanded: boolean, theme: Theme, expandedLines: () => string): string {
  const line = statusLine(status, theme);
  if (count === 0) return line;
  return expanded ? line + expandedLines() : line + expandHint(theme);
}

// --- Read tool ---

export function renderReadCall(args: any, theme: Theme, ctx: any): Component {
  return renderCall("Read", shortenPath(args.file_path ?? args.path ?? "", cwdOf(ctx)), theme, ctx);
}

export function renderReadResult(result: any, options: { expanded: boolean; isPartial: boolean }, theme: Theme, ctx: any): Component {
  if (options.isPartial || ctx.isPartial) return renderSuppressedPartial(ctx);

  const { text, images, hasText, lines, nonEmptyLines } = getResultOutput(result, ctx);
  if (!hasText && images > 0) {
    const count = plural(images, "image");
    return makeText(ctx.lastComponent, ctx.isError ? errorLabel(theme, count) : statusLine(`Read ${count}`, theme));
  }

  if (ctx.isError) {
    return makeText(ctx.lastComponent, errorResult(lines, options.expanded, theme, (l) => cachedExpandedLines(l, "tail", theme)));
  }

  const lineCount = nonEmptyLines.length;
  const status = `Read ${plural(lineCount, "line")}`;

  // Use MarkdownResult for .md files
  const filePath = ctx.args?.file_path ?? ctx.args?.path ?? "";
  if (options.expanded && lineCount > 0 && filePath.endsWith(".md")) {
    const label = statusLine(status, theme);
    const cached = ctx.state[READ_MARKDOWN] as ReadMarkdownCache | undefined;
    if (cached && cached.text === text && cached.label === label) return cached.component;
    const component = createMarkdownResult(label, text, getMarkdownTheme(), "head-tail", theme, true);
    ctx.state[READ_MARKDOWN] = { text, label, component } satisfies ReadMarkdownCache;
    return component;
  }

  return makeText(ctx.lastComponent, countedResult(status, lineCount, options.expanded, theme,
    () => cachedExpandedLines(lines, "head-tail", theme)));
}

// --- Grep tool ---

export function renderGrepCall(args: any, theme: Theme, ctx: any): Component {
  return renderCall("Search", searchSummary(args, ctx), theme, ctx);
}

export function renderGrepResult(result: any, options: { expanded: boolean; isPartial: boolean }, theme: Theme, ctx: any): Component {
  if (options.isPartial || ctx.isPartial) return renderSuppressedPartial(ctx);

  const { text, lines, nonEmptyLines } = getResultOutput(result, ctx);
  if (ctx.isError) {
    return makeText(ctx.lastComponent, errorResult(lines, options.expanded, theme, (l) => cachedExpandedLines(l, "tail", theme)));
  }

  const matchCount = text === "No matches found" ? 0 : nonEmptyLines.length;
  const status = matchCount === 0 ? "No matches found" : `Found ${plural(matchCount, "match", "matches")}`;
  return makeText(ctx.lastComponent, countedResult(status, matchCount, options.expanded, theme,
    () => cachedExpandedLines(lines, "head", theme)));
}

// --- Find tool ---

export function renderFindCall(args: any, theme: Theme, ctx: any): Component {
  return renderCall("Search", searchSummary(args, ctx), theme, ctx);
}

export function renderFindResult(result: any, options: { expanded: boolean; isPartial: boolean }, theme: Theme, ctx: any): Component {
  if (options.isPartial || ctx.isPartial) return renderSuppressedPartial(ctx);

  const { text, lines: items, nonEmptyLines: nonEmptyItems } = getResultOutput(result, ctx);
  if (ctx.isError) {
    return makeText(ctx.lastComponent, errorResult(items, options.expanded, theme, (l) => cachedExpandedLines(l, "tail", theme)));
  }

  const fileCount = text === "No files found matching pattern" ? 0 : nonEmptyItems.length;
  const status = fileCount === 0 ? "No files found" : `Found ${plural(fileCount, "file")}`;
  return makeText(ctx.lastComponent, countedResult(status, fileCount, options.expanded, theme,
    () => cachedExpandedLines(items, "head", theme, true)));
}

// --- Bash tool ---

export function renderBashCall(args: any, theme: Theme, ctx: any): Component {
  const cmd: string = args.command ?? "";
  const firstLine = cmd.split("\n", 1)[0];
  const maxPreview = 60;
  const preview = firstLine.length > maxPreview ? firstLine.slice(0, maxPreview) + "…"
    : firstLine !== cmd ? firstLine + " …" : cmd;
  return renderCall("Bash", preview, theme, ctx);
}

export function renderBashResult(result: any, options: { expanded: boolean; isPartial: boolean }, theme: Theme, ctx: any): Component {
  if (options.isPartial || ctx.isPartial) return renderSuppressedPartial(ctx);

  const { lines, nonEmptyLines, bashError } = getResultOutput(result, ctx);

  // Errors keep the exit status on the branch; output follows indented.
  if (ctx.isError) {
    const status = errorLabel(theme, bashError);
    if (nonEmptyLines.length === 0) return makeText(ctx.lastComponent, status);
    return makeText(ctx.lastComponent, status + (options.expanded ? cachedExpandedLines(lines, "tail", theme) : previewLines(lines, theme)));
  }

  // Successful output starts directly on the branch, like Claude Code.
  if (nonEmptyLines.length === 0) {
    return makeText(ctx.lastComponent, statusLine("(No content)", theme));
  }
  const block = options.expanded ? cachedExpandedLines(lines, "tail", theme) : previewLines(lines, theme);
  return makeText(ctx.lastComponent, onBranch(block, theme));
}

// --- Edit tool ---

export function renderEditCall(args: any, theme: Theme, ctx: any): Component {
  return renderCall("Update", shortenPath(args.path ?? "", cwdOf(ctx)), theme, ctx);
}

interface EditDiffCache { diff: string; style: string; additions: number; removals: number; lines: string[] }

/** Count +/- rows on the raw diff (rendered rows carry ANSI) and keep the rendered rows. */
function editDiff(ctx: any, diff: string, theme: Theme): EditDiffCache {
  const style = theme.fg("toolDiffAdded", "x") + theme.fg("toolDiffRemoved", "x") + theme.fg("toolDiffContext", "x");
  const cached = ctx.state.editDiff as EditDiffCache | undefined;
  if (cached && cached.diff === diff && cached.style === style) return cached;
  let additions = 0;
  let removals = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+")) additions++;
    else if (line.startsWith("-")) removals++;
  }
  const entry: EditDiffCache = { diff, style, additions, removals, lines: renderDiff(diff).split("\n") };
  ctx.state.editDiff = entry;
  return entry;
}

export function renderEditResult(result: any, options: { expanded: boolean; isPartial: boolean }, theme: Theme, ctx: any): Component {
  if (options.isPartial || ctx.isPartial) return renderSuppressedPartial(ctx);

  if (ctx.isError) {
    const { lines } = getResultOutput(result, ctx);
    return makeText(ctx.lastComponent, errorResult(lines, options.expanded, theme, (l) => cachedExpandedLines(l, "tail", theme)));
  }

  const path = shortenPath(ctx.args?.path ?? "", cwdOf(ctx));
  const diff = result.details?.diff;
  if (typeof diff !== "string" || !diff) {
    return makeText(ctx.lastComponent, statusLine(`Updated ${path}`, theme));
  }

  const { additions, removals, lines } = editDiff(ctx, diff, theme);
  const changes = [
    additions > 0 ? plural(additions, "addition") : "",
    removals > 0 ? plural(removals, "removal") : "",
  ].filter(Boolean).join(" and ");
  let out = statusLine(changes ? `Updated ${path} with ${changes}` : `Updated ${path}`, theme);

  // The diff is the point of an edit: show it without expanding, trimmed only when long.
  const max = CONFIG.tools.general.maxExpandedLines;
  const shown = options.expanded || max < 1 ? lines.length : Math.min(lines.length, max);
  for (let i = 0; i < shown; i++) out += "\n" + indentLine(lines[i]);
  const hidden = lines.length - shown;
  if (hidden > 0) {
    out += "\n" + indentLine(applyColor(theme, CONFIG.tools.general.expandHintColor, `… +${plural(hidden, "line")}`) + expandHint(theme));
  }
  return makeText(ctx.lastComponent, out);
}

// --- Write tool ---

export function renderWriteCall(args: any, theme: Theme, ctx: any): Component {
  const content: string = args.content ?? "";
  // Split once per content change: partial renders repeat while arguments stream.
  if (ctx.state.writeContent !== content) {
    ctx.state.writeContent = content;
    const lines = content.split("\n");
    ctx.state.writeLines = lines.slice(0, contentEnd(lines));
  }
  return renderCall("Write", shortenPath(args.path ?? "", cwdOf(ctx)), theme, ctx);
}

export function renderWriteResult(result: any, options: { expanded: boolean; isPartial: boolean }, theme: Theme, ctx: any): Component {
  if (options.isPartial || ctx.isPartial) return renderSuppressedPartial(ctx);

  if (ctx.isError) {
    const { lines } = getResultOutput(result, ctx);
    return makeText(ctx.lastComponent, errorResult(lines, options.expanded, theme, (l) => cachedExpandedLines(l, "tail", theme)));
  }

  const lines = (ctx.state.writeLines as string[] | undefined) ?? [];
  const path = shortenPath(ctx.args?.path ?? "", cwdOf(ctx));
  const status = statusLine(`Wrote ${plural(lines.length, "line")} to ${path}`, theme);
  if (lines.length === 0) return makeText(ctx.lastComponent, status);
  const body = options.expanded ? cachedExpandedLines(lines, "head", theme) : previewLines(lines, theme);
  return makeText(ctx.lastComponent, status + body);
}

// --- Ls tool ---

export function renderLsCall(args: any, theme: Theme, ctx: any): Component {
  return renderCall("List", shortenPath(args.path ?? ".", cwdOf(ctx)), theme, ctx);
}

export function renderLsResult(result: any, options: { expanded: boolean; isPartial: boolean }, theme: Theme, ctx: any): Component {
  if (options.isPartial || ctx.isPartial) return renderSuppressedPartial(ctx);

  const { text, lines: items, nonEmptyLines: nonEmptyItems } = getResultOutput(result, ctx);
  if (ctx.isError) {
    return makeText(ctx.lastComponent, errorResult(items, options.expanded, theme, (l) => cachedExpandedLines(l, "tail", theme)));
  }

  const itemCount = text === "(empty directory)" ? 0 : nonEmptyItems.length;
  return makeText(ctx.lastComponent, countedResult(`Listed ${plural(itemCount, "path")}`, itemCount, options.expanded, theme,
    () => cachedExpandedLines(items, "head", theme, true)));
}
