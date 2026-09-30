import type { Theme } from "@earendil-works/pi-coding-agent";
import { CONFIG } from "../config.js";
import { applyColor, applyBgColor } from "../utils.js";
import type { TrimStrategy } from "../types.js";
import { outputLines, formatExpandedLines } from "./tool-shared.js";

// Snapshot values, not result/array identity: tool results can be updated in place.
// Checking the few content blocks is cheap; joining/splitting/counting the potentially
// large text is performed only when those values change.
const results = new WeakMap<object, { parts: string[]; images: number; data: OutputData }>();
interface OutputData {
  text: string;
  lines: string[];
  nonEmptyLines: string[];
  images: number;
  hasText: boolean;
  bashError: string;
}

export function getResultOutput(result: any, ctx: any): OutputData {
  const parts: string[] = [];
  let images = 0;
  for (const block of Array.isArray(result?.content) ? result.content : []) {
    if (block?.type === "text" && typeof block.text === "string") parts.push(block.text);
    else if (block?.type === "image") images++;
  }
  const owner = ctx.state ??= {};
  const cached = results.get(owner);
  if (cached && cached.images === images && cached.parts.length === parts.length &&
      cached.parts.every((part, i) => part === parts[i])) return cached.data;
  const text = parts.join("\n");
  const lines = outputLines(text);
  const exitMatch = text.match(/Command exited with code (\d+)/);
  const data: OutputData = {
    text, lines, images,
    nonEmptyLines: lines.filter((line) => line.trim().length > 0),
    hasText: text.trim().length > 0,
    bashError: exitMatch ? `Exit ${parseInt(exitMatch[1], 10)}`
      : text.includes("Command aborted") || text.includes("Command timed out") ? "Aborted" : "Failed",
  };
  results.set(owner, { parts, images, data });
  return data;
}

// Probe the colors actually used instead of relying on theme identity. Pi can refresh
// a theme in place. Config changes (trimming, branch indent, colors) matter too.
export function outputStyleKey(theme: Theme, directories = false): string {
  const general = CONFIG.tools.general;
  return JSON.stringify([
    general.maxExpandedLines, CONFIG.tools.toolBranch.prefix,
    applyColor(theme, general.outputColor, "x"),
    applyBgColor(theme, general.moreBgColor || undefined, applyColor(theme, general.moreColor, "x")),
    directories ? applyColor(theme, "accent", theme.bold("x")) : "",
  ]);
}

const expandedOutputs = new WeakMap<string[], { theme: Theme; values: Map<string, string> }>();
export function cachedExpandedLines(lines: string[], strategy: TrimStrategy, theme: Theme, directories = false): string {
  const key = `${strategy}:${outputStyleKey(theme, directories)}`;
  let cache = expandedOutputs.get(lines);
  if (!cache || cache.theme !== theme) {
    cache = { theme, values: new Map() };
    expandedOutputs.set(lines, cache);
  }
  const existing = cache.values.get(key);
  if (existing !== undefined) return existing;
  const styled = lines.map((line) => directories && line.endsWith("/")
    ? applyColor(theme, "accent", theme.bold(line))
    : applyColor(theme, CONFIG.tools.general.outputColor, line));
  const formatted = formatExpandedLines(styled, strategy, theme);
  // Bound storage across repeated live theme/config changes.
  if (cache.values.size >= 4) cache.values.clear();
  cache.values.set(key, formatted);
  return formatted;
}
