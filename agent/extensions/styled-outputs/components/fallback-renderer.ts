import type { Component } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { CONFIG } from "../config.js";
import { applyColor } from "../utils.js";
import {
  makeText, toolHeader, statusLine, plural, onBranch, previewLines, errorResult,
  outputLines, getFirstTextContent, getImageContentCount, errorLabel, renderPartial,
  ensureSpinner, clearSpinner, spinnerDot, groupTitleColor,
  formatExpandedLines, renderSuppressedPartial,
} from "./tool-shared.js";

const FALLBACK_TITLE_COLOR = groupTitleColor("custom");

function argsSummary(args: any): string {
  if (!args || typeof args !== "object" || !Object.keys(args).length) return "";
  const query = args.query ?? args.name ?? args.path ?? args.input ?? args.text ?? args.command ?? args.url ?? args.keyword ?? args.search;
  if (typeof query === "string" && query) return query;
  for (const value of Object.values(args)) {
    if (typeof value === "string" && (value as string).length > 0) return value as string;
  }
  try {
    const json = JSON.stringify(args);
    return json.length > 60 ? json.slice(0, 60) + "…" : json;
  } catch {
    return "";
  }
}

export function renderFallbackCall(toolName: string, args: any, theme: Theme, ctx: any): Component {
  const summary = applyColor(theme, CONFIG.tools.general.summaryColor, argsSummary(args));
  if (ctx.isPartial) {
    const frame = ensureSpinner(ctx);
    return makeText(ctx.lastComponent, toolHeader(toolName, summary, theme, spinnerDot(theme, frame), undefined, FALLBACK_TITLE_COLOR) + "\n" + renderPartial(theme));
  }
  clearSpinner(ctx);
  return makeText(ctx.lastComponent, toolHeader(toolName, summary, theme, undefined, ctx.isError, FALLBACK_TITLE_COLOR));
}

export function renderFallbackResult(toolName: string, result: any, options: { expanded: boolean; isPartial: boolean }, theme: Theme, ctx: any): Component {
  if (options.isPartial || ctx.isPartial) return renderSuppressedPartial(ctx);

  const text = getFirstTextContent(result);
  const lines = outputLines(text);
  const hasText = lines.some((l: string) => l.trim().length > 0);
  const imageCount = getImageContentCount(result);
  const styled = () => lines.map((l: string) => applyColor(theme, CONFIG.tools.general.outputColor, l));

  if (!hasText && imageCount > 0) {
    const count = plural(imageCount, "image");
    return makeText(ctx.lastComponent, ctx.isError ? errorLabel(theme, count) : statusLine(count, theme));
  }

  if (ctx.isError) {
    return makeText(ctx.lastComponent, errorResult(lines, options.expanded, theme, () => formatExpandedLines(styled(), "tail", theme)));
  }

  if (!hasText) return makeText(ctx.lastComponent, statusLine("(No content)", theme));
  const block = options.expanded ? formatExpandedLines(styled(), "tail", theme) : previewLines(lines, theme);
  return makeText(ctx.lastComponent, onBranch(block, theme));
}
