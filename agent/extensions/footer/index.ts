import type { ExtensionAPI, ReadonlyFooterDataProvider, Theme, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { visibleWidth, truncateToWidth } from "@earendil-works/pi-tui";
import type { TUI } from "@earendil-works/pi-tui";

import type { SegmentContext, StatusLineSegmentId, UsageStats, SessionEvent, ToolResultEvent, UserBashEvent } from "./types.js";
import { renderSegment } from "./segments/index.js";
import { getGitStatus, invalidateGitStatus, invalidateGitBranch } from "./git-status.js";
import { getEffectiveConfig } from "./config.js";
import { getIcons } from "./icons.js";
import { getDefaultColors, fg } from "./theme.js";

const GIT_BRANCH_PATTERNS: RegExp[] = [
  /\bgit\s+(checkout|switch|branch\s+-[dDmM]|merge|rebase|pull|reset|worktree)/,
  /\bgit\s+stash\s+(pop|apply)/,
];

// ═══════════════════════════════════════════════════════════════════════════
// Status Line Builder
// ═══════════════════════════════════════════════════════════════════════════

/** Render a single segment and return its content with width */
function renderSegmentWithWidth(
  segId: StatusLineSegmentId,
  ctx: SegmentContext
): { content: string; width: number; visible: boolean } {
  const rendered = renderSegment(segId, ctx);
  if (!rendered.visible || !rendered.content) {
    return { content: "", width: 0, visible: false };
  }
  return { content: rendered.content, width: visibleWidth(rendered.content), visible: true };
}

/**
 * Build footer content from left and right segments.
 * Left segments are left-aligned, right segments are right-aligned.
 */
function buildFooterContent(
  ctx: SegmentContext,
  leftSegments: StatusLineSegmentId[],
  rightSegments: StatusLineSegmentId[],
  availableWidth: number,
): string {
  const maxContentWidth = Math.max(0, availableWidth - 2);

  // Render left segments
  const leftParts: string[] = [];
  for (const segId of leftSegments) {
    const { content, visible } = renderSegmentWithWidth(segId, ctx);
    if (visible) {
      leftParts.push(content);
    }
  }

  // Render right segments
  const rightParts: string[] = [];
  let rightWidth = 0;
  for (const segId of rightSegments) {
    const { content, width, visible } = renderSegmentWithWidth(segId, ctx);
    if (visible) {
      rightParts.push(content);
      rightWidth += width + 1; // +1 for space between
    }
  }
  if (rightParts.length > 0) {
    rightWidth -= 1; // Remove trailing space
  }

  let leftStr = leftParts.join(" ");
  let rightStr = rightParts.join(" ");

  // Handle case with no right segments
  if (rightParts.length === 0) {
    const finalLeft = truncateToWidth(leftStr, maxContentWidth);
    return " " + finalLeft + " ".repeat(Math.max(0, maxContentWidth - visibleWidth(finalLeft))) + " ";
  }

  // If right side alone is too big, just show right side
  if (rightWidth >= maxContentWidth) {
    return " " + truncateToWidth(rightStr, maxContentWidth) + " ";
  }

  // Ensure at least 1 space between left and right
  const maxLeftWidth = maxContentWidth - rightWidth - 1;
  const finalLeft = truncateToWidth(leftStr, Math.max(0, maxLeftWidth));
  const finalLeftWidth = visibleWidth(finalLeft);

  const padding = maxContentWidth - finalLeftWidth - rightWidth;

  const result = " " + finalLeft + " ".repeat(padding) + rightStr + " ";
  return truncateToWidth(result, availableWidth);
}

// ═══════════════════════════════════════════════════════════════════════════
// Extension
// ═══════════════════════════════════════════════════════════════════════════

export default function footer(pi: ExtensionAPI) {
  let sessionStartTime = Date.now();
  let currentCtx: ExtensionContext | null = null;
  let footerDataRef: ReadonlyFooterDataProvider | null = null;
  let sessionStats: {
    manager: ExtensionContext["sessionManager"];
    sessionId: string | undefined;
    leafId: string | null;
    entryCount: number;
    model: ExtensionContext["model"];
    modelWindow: number | undefined;
    catalog: { model: NonNullable<ExtensionContext["model"]>; window: number; provider: string; id: string }[];
    usageStats: UsageStats;
    contextUsage: ReturnType<ExtensionContext["getContextUsage"]>;
  } | null = null;
  let tuiRef: TUI | null = null;

  // Track session start
  pi.on("session_start", async (_event: unknown, ctx: ExtensionContext) => {
    sessionStartTime = Date.now();
    currentCtx = ctx;
    sessionStats = null;

    if (ctx.hasUI) {
      setupFooter(ctx);
    }
  });

  // Routed physical limits can change in agent state before the finalized
  // assistant is persisted (and before the leaf/count cache key moves).
  pi.on("message_end", (event) => {
    if (event.message.role === "assistant") sessionStats = null;
  });

  // Invalidate git status on file changes
  pi.on("tool_result", async (event: ToolResultEvent, _ctx: ExtensionContext) => {
    if (event.toolName === "write" || event.toolName === "edit") {
      invalidateGitStatus();
    }
    if (event.toolName === "bash" && event.input?.command) {
      const cmd = String(event.input.command);
      if (GIT_BRANCH_PATTERNS.some(p => p.test(cmd))) {
        invalidateGitStatus();
        invalidateGitBranch();
        setTimeout(() => tuiRef?.requestRender(), 100);
      }
    }
  });

  // Also catch user escape commands (! prefix)
  pi.on("user_bash", async (event: UserBashEvent, _ctx: ExtensionContext) => {
    if (GIT_BRANCH_PATTERNS.some(p => p.test(event.command))) {
      invalidateGitStatus();
      invalidateGitBranch();
      tuiRef?.requestRender();
    }
  });

  function getSessionStats(ctx: ExtensionContext) {
    // getEntryCount is new in Pi 0.99; older hosts expose only getEntries().
    const manager = ctx.sessionManager as ExtensionContext["sessionManager"] & { getEntryCount?: () => number };
    const sessionId = manager?.getSessionId?.();
    const leafId = manager?.getLeafId?.() ?? null;
    const model = ctx.model;
    const modelWindow = model?.contextWindow;
    // Virtual limits resolve through the live physical catalog. Its snapshot
    // check is independent of history; refresh/removal must invalidate context too.
    const catalog = model?.api === "pi-virtual" ? ctx.modelRegistry?.getAll?.() ?? [] : [];
    const catalogUnchanged = sessionStats && sessionStats.catalog.length === catalog.length &&
      catalog.every((entry, i) => {
        const cached = sessionStats!.catalog[i];
        return cached.model === entry && cached.window === entry.contextWindow &&
          cached.provider === entry.provider && cached.id === entry.id;
      });
    let entries: SessionEvent[] | undefined;
    const entryCount = typeof manager?.getEntryCount === "function"
      ? manager.getEntryCount()
      : (entries = manager?.getEntries?.() ?? []).length;

    // Check identity/count before either cumulative or canonical context scans.
    if (sessionStats && sessionStats.manager === manager &&
        sessionStats.sessionId === sessionId && sessionStats.leafId === leafId &&
        sessionStats.entryCount === entryCount && sessionStats.model === model &&
        sessionStats.modelWindow === modelWindow && catalogUnchanged) {
      return sessionStats;
    }

    const usageStats: UsageStats = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
    const allEntries: SessionEvent[] = entries ?? manager?.getEntries?.() ?? [];
    for (const entry of allEntries) {
      const usage = entry.type === "message"
        ? (entry.message?.role === "assistant" || entry.message?.role === "toolResult" ? entry.message.usage : undefined)
        : (entry.type === "usage" || entry.type === "compaction" || entry.type === "branch_summary" ? entry.usage : undefined);
      if (!usage) continue;
      // toolResult.usage already includes nested calls; never traverse nestedCalls.
      // Error/aborted assistants can also have spent usage.
      usageStats.input += usage.input;
      usageStats.output += usage.output;
      usageStats.cacheRead += usage.cacheRead;
      usageStats.cacheWrite += usage.cacheWrite;
      usageStats.cost += usage.cost.total;
    }

    sessionStats = {
      manager, sessionId, leafId, entryCount, model, modelWindow, usageStats,
      catalog: catalog.map((entry) => ({ model: entry, window: entry.contextWindow, provider: entry.provider, id: entry.id })),
      contextUsage: ctx.getContextUsage?.(),
    };
    return sessionStats;
  }

  function buildSegmentContext(ctx: ExtensionContext, width: number, theme: Theme): SegmentContext {
    const effectiveConfig = getEffectiveConfig();
    const colors = effectiveConfig.colors ?? getDefaultColors();
    const { usageStats, contextUsage } = getSessionStats(ctx);
    // Canonical context may be unknown after compaction, and may use a physical
    // model's limits rather than the selected virtual model's advertised window.
    const contextTokens = contextUsage?.tokens ?? null;
    const contextWindow = contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
    const contextPercent = contextUsage?.percent ?? null;

    // Get git status (cached)
    const gitBranch = footerDataRef?.getGitBranch() ?? null;
    const gitStatus = getGitStatus(gitBranch);

    // Check if using OAuth subscription
    const usingSubscription = ctx.model
      ? ctx.modelRegistry?.isUsingOAuth?.(ctx.model) ?? false
      : false;

    const isLocalModel = /localhost|127\.0\.0\.1|::1/.test((ctx.model as any)?.baseUrl ?? "");

    return {
      model: ctx.model,
      isLocalModel,
      thinkingLevel: pi.getThinkingLevel(),
      sessionId: ctx.sessionManager?.getSessionId?.(),
      usageStats,
      contextTokens,
      contextPercent,
      contextWindow,
      usingSubscription,
      sessionStartTime,
      git: gitStatus,
      options: effectiveConfig.segmentOptions ?? {},
      width,
      theme,
      colors,
      icons: getIcons(effectiveConfig.icons),
    };
  }

  function setupFooter(ctx: ExtensionContext) {
    ctx.ui.setFooter((tui: TUI, theme: Theme, footerData: ReadonlyFooterDataProvider) => {
      footerDataRef = footerData;
      tuiRef = tui;

      // Subscribe to branch changes for re-render
      const unsub = footerData.onBranchChange(() => tui.requestRender());

      return {
        dispose: unsub,
        invalidate() {},
        render(width: number): string[] {
          if (!currentCtx) return [];

          const effectiveConfig = getEffectiveConfig();
          let segmentCtx;
          try {
            segmentCtx = buildSegmentContext(currentCtx, width, theme);
          } catch {
            return [];
          }

          const row1 = buildFooterContent(
            segmentCtx,
            effectiveConfig.row1LeftSegments,
            effectiveConfig.row1RightSegments,
            width,
          );
          const row2 = buildFooterContent(
            segmentCtx,
            effectiveConfig.row2LeftSegments,
            effectiveConfig.row2RightSegments,
            width,
          );

          const divider = fg(theme, "separator", "─".repeat(width), segmentCtx.colors);

          return ["", row1, divider, row2];
        },
      };
    });
  }
}
