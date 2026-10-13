import type { RenderedSegment, SegmentContext } from "../types.js";
import { applyColor, resolveColorToRgb } from "../theme.js";
import { color } from "./helpers.js";
import { formatTokens } from "./helpers.js";

// Set to a number (0–100) to override context % for visual testing, null to disable
const DEBUG_PCT: number | null = null;

const DEFAULT_BAR_WIDTH     = 18;
const DEFAULT_FILLED_CHAR   = "▋";
const DEFAULT_UNFILLED_CHAR = "▋";
const DEFAULT_UNFILLED_COLOR = "#4e4c49";
const DEFAULT_START = { r: 0xf2, g: 0x93, b: 0x73 };
const DEFAULT_MID   = { r: 0xd6, g: 0x78, b: 0x58 };
const DEFAULT_END   = { r: 0xae, g: 0x4f, b: 0x2f };
const DEFAULT_MID_FRAC = 0.55; // 0–1: where MID sits along the gradient
const DEFAULT_WARN_AT  = 60;
const DEFAULT_ERROR_AT = 85;

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function positionColor(
  pos: number,
  barWidth: number,
  start: { r: number; g: number; b: number },
  mid: { r: number; g: number; b: number },
  end: { r: number; g: number; b: number },
  midFrac: number,
): string {
  const t = pos / Math.max(barWidth - 1, 1);
  let r: number, g: number, b: number;
  if (t <= midFrac) {
    const f = t / midFrac;
    r = lerp(start.r, mid.r, f);
    g = lerp(start.g, mid.g, f);
    b = lerp(start.b, mid.b, f);
  } else {
    const f = (t - midFrac) / (1 - midFrac);
    r = lerp(mid.r, end.r, f);
    g = lerp(mid.g, end.g, f);
    b = lerp(mid.b, end.b, f);
  }
  return `\x1b[38;2;${r};${g};${b}m`;
}

export const contextPctSegment = {
  id: "context_pct" as const,
  render(ctx: SegmentContext): RenderedSegment {
    const pct = DEBUG_PCT ?? ctx.contextPercent;
    const barOpts = ctx.options.contextBar ?? {};

    const barWidth     = barOpts.barWidth     ?? DEFAULT_BAR_WIDTH;
    const filledChar   = barOpts.filledChar   ?? DEFAULT_FILLED_CHAR;
    const unfilledChar = barOpts.unfilledChar ?? DEFAULT_UNFILLED_CHAR;
    const unfilledColor = barOpts.unfilledColor ?? DEFAULT_UNFILLED_COLOR;
    const start   = (barOpts.gradientStart ? resolveColorToRgb(ctx.theme, barOpts.gradientStart) : null) ?? DEFAULT_START;
    const mid     = (barOpts.gradientMid   ? resolveColorToRgb(ctx.theme, barOpts.gradientMid)   : null) ?? DEFAULT_MID;
    const end     = (barOpts.gradientEnd   ? resolveColorToRgb(ctx.theme, barOpts.gradientEnd)   : null) ?? DEFAULT_END;
    const midFrac = barOpts.gradientMidPoint ?? DEFAULT_MID_FRAC;

    const filled = pct === null ? 0 : Math.round((pct / 100) * barWidth);

    // Threshold mode stays neutral until the window is worth watching.
    let level = "contextLabel";
    if (barOpts.colorMode === "threshold" && pct !== null) {
      if (pct >= (barOpts.errorAt ?? DEFAULT_ERROR_AT)) level = "contextError";
      else if (pct >= (barOpts.warnAt ?? DEFAULT_WARN_AT)) level = "contextWarn";
    }

    let bar = "";
    if (barOpts.colorMode === "threshold") {
      if (filled > 0) bar += color(ctx, level, filledChar.repeat(filled));
      if (filled < barWidth) bar += applyColor(ctx.theme, unfilledColor, unfilledChar.repeat(barWidth - filled));
    } else {
      for (let i = 0; i < barWidth; i++) {
        if (i < filled) {
          bar += positionColor(i, barWidth, start, mid, end, midFrac) + filledChar;
        } else {
          bar += applyColor(ctx.theme, unfilledColor, unfilledChar);
        }
      }
      bar += "\x1b[0m";
    }

    if (barOpts.compactLabel) {
      const pctStr = color(ctx, level, pct === null ? "?" : `${Math.round(pct)}%`);
      const windowStr = applyColor(ctx.theme, "dim", `/${formatTokens(ctx.contextWindow)}`);
      return { content: `${bar} ${pctStr}${windowStr}`, visible: true };
    }

    const pctLabel = pct === null ? "?" : `${pct.toFixed(1)}%`;
    const pctStr = color(ctx, level, pctLabel);
    const tokensLabel = `/ ${formatTokens(ctx.contextWindow)}`;
    const tokensStr = color(ctx, "contextLabel", tokensLabel);

    return { content: `${bar} ${pctStr} ${tokensStr}`, visible: true };
  },
};

export const contextTotalSegment = {
  id: "context_total" as const,
  render(ctx: SegmentContext): RenderedSegment {
    const window = ctx.contextWindow;
    if (!window) return { content: "", visible: false };
    return {
      content: color(ctx, "context", `${window}`),
      visible: true,
    };
  },
};
