/**
 * Spinners extension for pi.dev.
 *
 * Replaces the default "Thinking" verb with a random alternative from a curated list.
 * Shows the complete verb immediately and keeps it fixed throughout each turn.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
  SessionStartEvent,
  TurnEndEvent,
  TurnStartEvent,
} from "@earendil-works/pi-coding-agent";
import { getKeybindings } from "@earendil-works/pi-tui";
import { loadConfig } from "./config.js";
import { pickVerb } from "./verbs.js";

const { themeTokens } = loadConfig();

const REFRESH_INTERVAL_MS = 1000;
const TOKENS_PER_CHAR = 4; // Rough estimate: 1 token ≈ 4 characters
const WORKING_FRAMES = ["·", "✢", "✳", "✶", "✻", "✽"];

interface TextBlock {
  type: "text";
  text: string;
}

function isTextBlock(block: unknown): block is TextBlock {
  return (
    typeof block === "object" &&
    block !== null &&
    "type" in block &&
    (block as any).type === "text" &&
    "text" in block &&
    typeof (block as any).text === "string"
  );
}

/**
 * Applies theme color to text using pi.dev theme.
 * Falls back to plain text if theming fails.
 */
function colorize(theme: any, semantic: string, text: string): string {
  try {
    return theme.fg(semantic, text);
  } catch {
    return text;
  }
}

/**
 * Formats milliseconds into human-readable duration.
 * @example 75000 → "1m 15s"
 */
function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/**
 * Formats number with locale-aware commas.
 * @example 1234 → "1,234"
 */
function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

/**
 * Estimates total character count from message content blocks.
 */
function estimateResponseLength(content: unknown): number {
  if (!Array.isArray(content)) return 0;
  return content.reduce(
    (sum, block) => sum + (isTextBlock(block) ? block.text.length : 0),
    0,
  );
}

/**
 * Extracts text lengths from each content block.
 * @returns Array of text lengths (0 for non-text blocks)
 */
function textBlockLengths(content: unknown): number[] {
  if (!Array.isArray(content)) return [];
  return content.map((block) => (isTextBlock(block) ? block.text.length : 0));
}

export default function spinners(pi: ExtensionAPI) {
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let currentVerb = "";
  let agentStartTime = 0;
  let turnStartTime = 0;
  let activeCtx: ExtensionContext | null = null;
  let responseLength = 0;
  let responseTextBlockLengths: number[] = [];

  /**
   * Stops all active timers.
   */
  function stopAllTimers(): void {
    if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
  }

  /**
   * Resets all state to initial values.
   */
  function resetState(): void {
    stopAllTimers();
    if (activeCtx) restoreDefaultWorkingMessage(activeCtx);
    agentStartTime = 0;
    turnStartTime = 0;
    responseLength = 0;
    responseTextBlockLengths = [];
    activeCtx = null;
  }

  /**
   * Builds status parts array (elapsed time, token count).
   */
  function buildStatusParts(): string[] {
    const elapsed = Date.now() - (agentStartTime || turnStartTime);
    const tokenCount = Math.max(0, Math.round(responseLength / TOKENS_PER_CHAR));
    const parts: string[] = [formatDuration(elapsed)];
    if (responseLength > 0 || tokenCount > 0) parts.push(`↓ ${formatCount(tokenCount)} tokens`);
    return parts;
  }

  /**
   * Builds complete working message with verb and status.
   * @param ctx - Extension context with UI
   */
  function buildWorkingMessage(ctx: ExtensionContext): string {
    const parts = buildStatusParts();
    const verbText = colorize(ctx.ui.theme, themeTokens.verb, `${currentVerb}…`);
    const separator = colorize(ctx.ui.theme, themeTokens.separator, themeTokens.separatorIcon);
    const status = parts.map(part => colorize(ctx.ui.theme, themeTokens.status, part))
      .join(` ${separator} `);
    return `${verbText} ${colorize(ctx.ui.theme, themeTokens.status, "(")}${status}${colorize(ctx.ui.theme, themeTokens.status, ")")}`;
  }

  /**
   * Updates the working message in the UI.
   * @param ctx - Extension context with UI
   */
  function syncWorkingMessage(ctx: ExtensionContext): void {
    if (!ctx.hasUI) return;
    try {
      ctx.ui.setWorkingMessage(buildWorkingMessage(ctx));
    } catch {
      // noop
    }
  }

  /**
   * Restores the default working message.
   * @param ctx - Extension context with UI
   */
  function restoreDefaultWorkingMessage(ctx: ExtensionContext): void {
    if (!ctx.hasUI) return;
    try {
      ctx.ui.setWorkingMessage();
      ctx.ui.setWorkingIndicator();
    } catch {
      // noop
    }
  }

  /**
   * Starts refresh loop to update status every second.
   * @param ctx - Extension context with UI
   */
  function startRefreshLoop(ctx: ExtensionContext): void {
    const schedule = () => {
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        // Always refresh status (elapsed time changes every second)
        syncWorkingMessage(ctx);
        schedule();
      }, REFRESH_INTERVAL_MS);
    };
    schedule();
  }

  /**
   * Updates tracked length for a specific text block.
   * @param index - Block index
   * @param length - New length in characters
   */
  function setResponseTextBlockLength(index: number, length: number): void {
    const previous = responseTextBlockLengths[index] ?? 0;
    responseTextBlockLengths[index] = Math.max(0, length);
    responseLength = Math.max(0, responseLength + responseTextBlockLengths[index] - previous);
  }

  /**
   * Resets response tracking based on content.
   * @param content - Optional message content to initialize tracking
   */
  function resetResponseTracking(content?: unknown): void {
    responseTextBlockLengths = content ? textBlockLengths(content) : [];
    responseLength = content ? estimateResponseLength(content) : 0;
  }

  // Hidden thinking block hint
  pi.on("session_start", async (_event: SessionStartEvent, ctx: ExtensionContext) => {
    if (!ctx.hasUI) return;
    const toggleKey = getKeybindings().getKeys("app.thinking.toggle")[0] ?? "ctrl+t";
    ctx.ui.setHiddenThinkingLabel(`→ ${toggleKey} to show thinking block`);
  });

  pi.on("turn_start", async (_event: TurnStartEvent, ctx: ExtensionContext) => {
    activeCtx = ctx;
    turnStartTime = Date.now();
    if (!agentStartTime) agentStartTime = turnStartTime;
    if (!ctx.hasUI) return;
    if (refreshTimer) return;

    ctx.ui.setWorkingIndicator({
      frames: WORKING_FRAMES.map(frame => colorize(ctx.ui.theme, themeTokens.verb, frame)),
      intervalMs: 120,
    });
    resetResponseTracking();
    currentVerb = pickVerb();
    syncWorkingMessage(ctx);
    startRefreshLoop(ctx);
  });

  pi.on("message_update", async (event, _ctx: ExtensionContext) => {
    const evt: any = (event as any).assistantMessageEvent ?? (event as any).delta ?? {};

    if (evt.type === "start") {
      resetResponseTracking();
    } else if (evt.type === "text_start") {
      setResponseTextBlockLength(evt.contentIndex, 0);
    } else if (evt.type === "text" || evt.type === "text_delta") {
      const prev = responseTextBlockLengths[evt.contentIndex] ?? 0;
      setResponseTextBlockLength(
        evt.contentIndex,
        prev + (typeof evt.delta === "string" ? evt.delta.length : 0),
      );
      if (activeCtx) syncWorkingMessage(activeCtx);
    } else if (evt.type === "text_end") {
      setResponseTextBlockLength(
        evt.contentIndex,
        typeof evt.content === "string" ? evt.content.length : 0,
      );
    } else if (evt.type === "done") {
      resetResponseTracking(evt.message?.content);
    }

    if (activeCtx) syncWorkingMessage(activeCtx);
  });

  pi.on("turn_end", async (_event: TurnEndEvent, ctx: ExtensionContext) => {
    activeCtx = ctx;
    stopAllTimers();
    if (activeCtx?.hasUI) restoreDefaultWorkingMessage(activeCtx);
    responseLength = 0;
    responseTextBlockLengths = [];
  });

  pi.on("agent_end", async () => {
    resetState();
  });

  pi.on("session_shutdown", async () => {
    resetState();
  });
}
