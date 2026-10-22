import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type TitleEffort = ReturnType<ExtensionAPI["getThinkingLevel"]>;
interface TaskTitleConfig {
  provider?: string;
  model?: string;
  effort?: TitleEffort;
}

function loadConfig(warn: (message: string) => void): TaskTitleConfig {
  const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
  try {
    const config = JSON.parse(readFileSync(join(agentDir, "configs", "task-title.json"), "utf8"));
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      throw new Error("expected an object");
    }
    const { provider, model, effort } = config;
    if ((provider !== undefined || model !== undefined) &&
        (typeof provider !== "string" || !provider.trim() || typeof model !== "string" || !model.trim())) {
      throw new Error("provider and model must both be nonblank strings");
    }
    if (effort !== undefined && !["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(effort)) {
      throw new Error("invalid effort");
    }
    return { provider: provider?.trim(), model: model?.trim(), effort };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      warn("Task-title: invalid configuration; using the session model and effort.");
    }
    return {};
  }
}

const MAX_TITLE_LENGTH = 50;
const MODEL_MAX_TOKENS = 2048;
const MODEL_TIMEOUT_MS = 45_000;
const TITLE_INSTRUCTIONS = [
  "You name terminal tabs. Read the task below and answer with a title for it.",
  "At most 6 words. No quotes, no trailing period, no preamble.",
  "Write it in the same language the task is written in.",
].join(" ");

/** The first nonblank prompt line, or null when it names no task. */
export function deriveTitle(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const line = text.split("\n").find((candidate) => candidate.trim().length > 0);
  if (!line) return null;
  const trimmed = line.trim();
  if (trimmed.startsWith("/") || trimmed.startsWith("!")) return null;
  const collapsed = trimmed.replace(/\s+/g, " ");
  return collapsed.length <= MAX_TITLE_LENGTH
    ? collapsed
    : `${collapsed.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`;
}

export function cleanModelTitle(text: unknown): string | null {
  if (typeof text !== "string") return null;
  return deriveTitle(text.trim().replace(/^["'`]+/, "").replace(/["'`.]+$/, ""));
}

function messageText(message: { content: unknown }): string | null {
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const block = content.find((part) => part?.type === "text" && typeof part.text === "string");
  return block ? block.text : null;
}

/** Preserve the whole first task for the model, not just its truncated title. */
export function firstPrompt(ctx: Partial<Pick<ExtensionContext, "sessionManager">>): string | null {
  const entries = ctx.sessionManager?.getEntries();
  if (!entries) return null;
  for (const entry of entries) {
    if (entry.type !== "message" || entry.message.role !== "user") continue;
    const text = messageText(entry.message);
    if (deriveTitle(text)) return text;
  }
  return null;
}

export function firstPromptTitle(ctx: Partial<Pick<ExtensionContext, "sessionManager">>): string | null {
  return deriveTitle(firstPrompt(ctx));
}

async function askModel(ctx: ExtensionContext, prompt: string, signal: AbortSignal, effort: TitleEffort, warn: (message: string) => void): Promise<string | null> {
  const config = loadConfig(warn);
  let model = ctx.model;
  let selectedEffort = config.effort ?? effort;
  if (config.provider && config.model) {
    const configured = ctx.modelRegistry.find(config.provider, config.model);
    if (configured) model = configured;
    else {
      warn(`Task-title: model ${config.provider}/${config.model} not found; using the session model and effort.`);
      selectedEffort = effort;
    }
  }
  if (!model) throw new Error("No model available for title generation");
  const response = await ctx.modelRegistry.streamSimple(
    model,
    {
      systemPrompt: TITLE_INSTRUCTIONS,
      messages: [{ role: "user", content: [{ type: "text", text: prompt }], timestamp: Date.now() }],
    },
    {
      reasoning: selectedEffort === "off" ? undefined : selectedEffort,
      maxTokens: MODEL_MAX_TOKENS,
      cacheRetention: "none",
      signal: AbortSignal.any([signal, AbortSignal.timeout(MODEL_TIMEOUT_MS)]),
    },
  ).result();
  if (response.stopReason === "error" || response.stopReason === "aborted") {
    throw new Error(response.errorMessage || `Title request ${response.stopReason}`);
  }
  const answer = response.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
  const title = cleanModelTitle(answer);
  if (!title) throw new Error("Model returned no usable title");
  return title;
}

export default function taskTitle(pi: ExtensionAPI): void {
  let prompt: string | null = null;
  let title: string | null = null;
  let generation = 0;
  let request: AbortController | undefined;
  const reset = () => {
    generation++;
    request?.abort();
    request = undefined;
    prompt = null;
    title = null;
  };
  const named = (ctx: ExtensionContext) => Boolean(ctx.sessionManager.getSessionName());

  const apply = (ctx: ExtensionContext) => {
    if (!title || named(ctx)) return;
    const shown = title;
    const current = generation;
    // Pi also updates the terminal during these events; apply ours afterward.
    setTimeout(() => {
      if (current !== generation || named(ctx)) return;
      try {
        ctx.ui.setTitle(shown);
      } catch {
        // A closing terminal must not interrupt the agent.
      }
    }, 0);
  };

  const take = (ctx: ExtensionContext, text: string | null) => {
    if (ctx.mode !== "tui" || prompt || named(ctx)) return;
    const fallback = deriveTitle(text);
    if (!fallback || !text) return;
    prompt = text;
    title = fallback;
    apply(ctx);
    // Never hold up the agent for a title; errors leave the prompt title standing.
    const current = generation;
    request = new AbortController();
    const warn = (message: string) => {
      if (current === generation) ctx.ui.notify(message, "warning");
    };
    void askModel(ctx, text, request.signal, pi.getThinkingLevel(), warn).then((better) => {
      if (!better || current !== generation) return;
      title = better;
      apply(ctx);
    }).catch((error: unknown) => {
      warn(`Task-title: could not generate title; keeping prompt title. ${error instanceof Error ? error.message : String(error)}`);
    });
  };

  pi.on("session_start", (_event, ctx) => {
    reset();
    take(ctx, firstPrompt(ctx));
  });
  pi.on("input", (event, ctx) => {
    if (event.source !== "extension") take(ctx, firstPrompt(ctx) ?? event.text);
    return { action: "continue" };
  });
  pi.on("agent_start", (_event, ctx) => take(ctx, firstPrompt(ctx)));
  pi.on("session_info_changed", (_event, ctx) => apply(ctx));
  pi.on("session_shutdown", reset);
}
