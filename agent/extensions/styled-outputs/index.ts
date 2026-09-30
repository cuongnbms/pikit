import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Theme, AssistantMessageComponent, UserMessageComponent, ToolExecutionComponent, SkillInvocationMessageComponent, CustomMessageComponent, BashExecutionComponent, createReadToolDefinition, createBashToolDefinition, createEditToolDefinition, createWriteToolDefinition, createLsToolDefinition, createGrepToolDefinition, createFindToolDefinition, truncateTail, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, keyText } from "@earendil-works/pi-coding-agent";
import { Box, Markdown, Text } from "@earendil-works/pi-tui";
import { PATCH_FLAG, setCurrentTheme, currentTheme, applyColor, toolPrefix, errorPrefix, fitLineToWidth } from "./utils.js";
import { CONFIG } from "./config.js";
import { createAssistantMessage } from "./components/assistant-message.js";
import { createThinkingMessage } from "./components/thinking-message.js";
import { createUserMessage } from "./components/user-message.js";
import {
  renderReadCall, renderReadResult,
  renderBashCall, renderBashResult,
  renderEditCall, renderEditResult,
  renderWriteCall, renderWriteResult,
  renderLsCall, renderLsResult,
  renderGrepCall, renderGrepResult,
  renderFindCall, renderFindResult,
} from "./components/base-renderer.js";
import { renderFallbackCall, renderFallbackResult } from "./components/fallback-renderer.js";
import { createSkillInvocationMessage } from "./components/skill-message.js";
import { createCustomMessage } from "./components/custom-message.js";
import { branchLine, doneLabel, errorLabel, expandHint, formatExpandedLines, startToolSpinnerSession, stopToolSpinners } from "./components/tool-shared.js";

export default function styledOutputs(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    setCurrentTheme(ctx.ui.theme);
    startToolSpinnerSession();
  });
  pi.on("session_shutdown", stopToolSpinners);

  // --- Patch AssistantMessageComponent ---
  const assistantProto = AssistantMessageComponent.prototype as any;
  if (!assistantProto[PATCH_FLAG]) {
    const originalUpdateContent = assistantProto.updateContent;
    assistantProto.updateContent = function patchedUpdateContent(message: any, ...args: any[]) {
      if (!message?.content || !Array.isArray(message.content)) {
        return originalUpdateContent.call(this, message, ...args);
      }

      originalUpdateContent.call(this, message, ...args);

      const container = this.contentContainer;
      if (!container?.children) return;

      for (let i = container.children.length - 1; i >= 0; i--) {
        const child = container.children[i] as any;
        const mdChild = child instanceof Markdown
          ? child
          : child?.child instanceof Markdown
            ? child.child
            : undefined;
        if (!mdChild) continue;

        const text = mdChild.text;
        if (!text) continue;

        const isThinking = !!mdChild.defaultTextStyle?.italic;
        const replacement = isThinking
          ? createThinkingMessage(text, mdChild)
          : createAssistantMessage(text, mdChild);

        if (child instanceof Markdown) {
          container.children[i] = replacement;
        } else {
          child.child = replacement;
        }
      }
    };

    assistantProto[PATCH_FLAG] = true;
  }

  // --- Patch UserMessageComponent ---
  const userProto = UserMessageComponent.prototype as any;
  if (!userProto[PATCH_FLAG]) {
    const originalUserRender = userProto.render;
    userProto.render = function patchedUserRender(width: number) {
      if (width <= 0) return [];
      const contentBox = this.children?.find((child: any) => child instanceof Box && Array.isArray(child.children));
      if (contentBox?.children) {
        for (let i = 0; i < contentBox.children.length; i++) {
          const child = contentBox.children[i];
          if (child instanceof Markdown) {
            const mdChild = child as any;
            const text = mdChild.text;
            if (text) {
              contentBox.children[i] = createUserMessage(text, mdChild);
            }
          }
        }

        contentBox.paddingX = 0;

        if (!CONFIG.userMessage.isThemeBackgroundVisible) {
          contentBox.paddingY = 0;
          contentBox.setBgFn(undefined);
        }
      }
      return originalUserRender.call(this, width);
    };

    userProto[PATCH_FLAG] = true;
  }

  // --- Patch ToolExecutionComponent (conditionally apply bg) ---
  const toolProto = ToolExecutionComponent.prototype as any;
  if (!toolProto[PATCH_FLAG]) {
    const originalUpdateDisplay = toolProto.updateDisplay;
    toolProto.updateDisplay = function patchedUpdateDisplay() {
      originalUpdateDisplay.call(this);
      if (this.contentBox) {
        this.contentBox.paddingY = CONFIG.tools.general.verticalPadding;
        this.contentBox.paddingX = CONFIG.tools.general.horizontalPadding;
        if (CONFIG.tools.general.isThemeBackgroundVisible) {
          const t = currentTheme!;
          const bgFn = this.isPartial
            ? (text: string) => t.bg("toolPendingBg", text)
            : this.result?.isError
              ? (text: string) => t.bg("toolErrorBg", text)
              : (text: string) => t.bg("toolSuccessBg", text);
          this.contentBox.setBgFn(bgFn);
        } else {
          this.contentBox.setBgFn(undefined);
        }
      }
    };

    // Native Box padding is fixed; reduce our margins when the terminal is narrower.
    const originalToolRender = toolProto.render;
    toolProto.render = function patchedToolRender(width: number) {
      if (width <= 0) return [];
      this.contentBox.paddingX = Math.min(
        CONFIG.tools.general.horizontalPadding,
        Math.max(0, Math.floor((width - 1) / 2)),
      );
      return originalToolRender.call(this, width).map((line: string) => fitLineToWidth(line, width));
    };

    // --- Inject fallback renderer for tools without custom renderers ---
    const originalGetCallRenderer = toolProto.getCallRenderer;
    toolProto.getCallRenderer = function patchedGetCallRenderer() {
      const renderer = originalGetCallRenderer.call(this);
      if (renderer !== undefined) return renderer;
      const label = this.toolDefinition?.label ?? this.toolName;
      return (args: any, theme: any, ctx: any) => renderFallbackCall(label, args, theme, ctx);
    };

    const originalGetResultRenderer = toolProto.getResultRenderer;
    toolProto.getResultRenderer = function patchedGetResultRenderer() {
      const renderer = originalGetResultRenderer.call(this);
      if (renderer !== undefined) return renderer;
      const label = this.toolDefinition?.label ?? this.toolName;
      return (result: any, options: any, theme: any, ctx: any) => renderFallbackResult(label, result, options, theme, ctx);
    };

    toolProto[PATCH_FLAG] = true;
  }

  // --- Patch SkillInvocationMessageComponent ---
  const skillProto = SkillInvocationMessageComponent.prototype as any;
  if (!skillProto[PATCH_FLAG]) {
    skillProto.updateDisplay = function patchedSkillUpdateDisplay() {
      if (!this.skillBlock) return;

      if (!this._styledSkillComponent) {
        this._styledSkillComponent = createSkillInvocationMessage(
          this.skillBlock.name,
          this.skillBlock.content,
          this.markdownTheme,
        );
      }

      // Strip Box padding — our component handles its own layout
      this.paddingX = 0;
      this.paddingY = 0;
      if (CONFIG.tools.general.isThemeBackgroundVisible) {
        this.bgFn = (text: string) => currentTheme!.bg("customMessageBg", text);
      } else {
        this.bgFn = undefined;
      }

      this._styledSkillComponent.setExpanded(this.expanded);
      this.clear();
      this.addChild(this._styledSkillComponent);
    };

    skillProto[PATCH_FLAG] = true;
  }

  // --- Patch CustomMessageComponent ---
  const customProto = CustomMessageComponent.prototype as any;
  if (!customProto[PATCH_FLAG]) {
    customProto.rebuild = function patchedCustomRebuild() {
      // Extract text content from message
      let textContent: string;
      if (typeof this.message.content === "string") {
        textContent = this.message.content;
      } else {
        textContent = this.message.content
          .filter((c: any) => c.type === "text")
          .map((c: any) => c.text)
          .join("\n");
      }

      // Create styled custom message component
      this._styledCustomComponent = createCustomMessage(
        this.message.customType,
        textContent,
        this.message.details,
        this.markdownTheme,
      );

      // Strip Box padding — our component handles its own layout
      this.paddingX = 0;
      this.paddingY = 0;
      if (CONFIG.tools.general.isThemeBackgroundVisible) {
        this.bgFn = (text: string) => currentTheme!.bg("customMessageBg", text);
      } else {
        this.bgFn = undefined;
      }

      this._styledCustomComponent.setExpanded(this._expanded);
      this.clear();
      this.addChild(this._styledCustomComponent);
    };

    const originalSetExpanded = customProto.setExpanded;
    customProto.setExpanded = function patchedCustomSetExpanded(expanded: boolean) {
      if (this._styledCustomComponent) {
        this._styledCustomComponent.setExpanded(expanded);
      }
      return originalSetExpanded.call(this, expanded);
    };

    customProto[PATCH_FLAG] = true;
  }

  // --- Patch BashExecutionComponent (! / !! commands) ---
  const bashExecProto = BashExecutionComponent.prototype as any;
  const BASH_STATE = Symbol.for("styled-outputs:bash-state");
  const bashState = bashExecProto[BASH_STATE] ??= { timers: new Set<any>() };

  const clearStyledBashTimer = (instance: any) => {
    if (instance._spinnerInterval) {
      clearInterval(instance._spinnerInterval);
      bashState.timers.delete(instance._spinnerInterval);
      instance._spinnerInterval = undefined;
    }
  };

  pi.on("session_shutdown", async () => {
    for (const timer of bashState.timers) {
      clearInterval(timer);
    }
    bashState.timers.clear();
  });

  if (!bashExecProto[PATCH_FLAG]) {
    const SPINNER_CHARS = CONFIG.tools.toolSpinnerPrefix.prefixChars;
    const SPINNER_FRAMES = [...SPINNER_CHARS, ...[...SPINNER_CHARS].reverse()];
    const SPINNER_INTERVAL = 80;

    const deriveExcludeFromNativeInstance = (instance: any): boolean => {
      if (typeof instance.excludeFromContext === "boolean") return instance.excludeFromContext;
      // Pi 0.80–0.99 keeps the semantic token only in its native border closure.
      // Observe that synchronous call, not ANSI equality (theme colors can coincide).
      const originalFg = Theme.prototype.fg;
      let token: string | undefined;
      try {
        Theme.prototype.fg = function (color, text) {
          token = color;
          return originalFg.call(this, color, text);
        };
        instance.children?.[1]?.color?.("");
        return token === "dim";
      } finally {
        Theme.prototype.fg = originalFg;
      }
    };

    const startStyledBashTimer = (instance: any) => {
      if (instance.status !== "running" || instance._spinnerInterval) return;
      instance._spinnerFrame = instance._spinnerFrame ?? 0;
      instance._spinnerInterval = setInterval(() => {
        instance._spinnerFrame = (instance._spinnerFrame + 1) % SPINNER_FRAMES.length;
        instance.updateDisplay();
        instance._tui?.requestRender();
      }, SPINNER_INTERVAL);
      bashState.timers.add(instance._spinnerInterval);
    };

    // Patch render to call updateDisplay first — ensures styled output from
    // the very first frame (not the original bordered layout). Needed because
    // updateDisplay is otherwise only triggered by appendOutput, meaning
    // commands like `! sleep 5 && echo "test"` show unstyled for 5s.
    const origRender = bashExecProto.render;
    bashExecProto.render = function patchedRender(width: number) {
      if (width <= 0) return [];
      this.updateDisplay();
      return origRender.call(this, width).map((line: string) => fitLineToWidth(line, width));
    };

    // Replace updateDisplay with styled version matching tool call pattern
    bashExecProto.updateDisplay = function patchedBashUpdateDisplay() {
      const t = currentTheme!;
      const bc = CONFIG.bashExecution;
      const tc = CONFIG.tools;

      // First-run: remove native frame and keep native per-instance Command/Shell state.
      if (!this._styledInitDone) {
        this._excludeFromContext = deriveExcludeFromNativeInstance(this);

        // Remove borders + spacer from original constructor (children layout: Spacer, DynamicBorder, contentContainer, DynamicBorder)
        this.children.splice(this.children.length - 1, 1); // bottom border
        this.children.splice(1, 1);                        // top border
        this.children.splice(0, 1);                        // spacer

        // Stop original loader — we render our own status line
        this.loader.stop();

        // Store TUI ref for requestRender in spinner (Loader had it but we stopped it)
        this._tui = (this.loader as any).ui;
        this._spinnerFrame = 0;
        this._styledInitDone = true;
      }

      if (this.status === "running") {
        startStyledBashTimer(this);
      } else {
        clearStyledBashTimer(this);
      }

      // Truncation
      const fullOutput = (this.outputLines as string[]).join("\n");
      const contextTruncation = truncateTail(fullOutput, {
        maxLines: DEFAULT_MAX_LINES,
        maxBytes: DEFAULT_MAX_BYTES,
      });
      const availableLines = contextTruncation.content ? contextTruncation.content.split("\n") : [];
      const nonEmptyLines = availableLines.filter((l: string) => l.trim().length > 0);

      // Rebuild content container
      const cc = this.contentContainer as any;
      cc.clear();

      // --- Header: <prefix-icon> <Command|Shell> <dim-command> ---
      const typeLabel = this._excludeFromContext ? "Shell" : "Command";
      const labelText = applyColor(t, bc.titleColor, t.bold(typeLabel));
      const cmdText = applyColor(t, tc.general.summaryColor, ` ${this.command}`);

      let headerLine: string;
      if (this.status === "running") {
        const frame = (this._spinnerFrame as number) ?? 0;
        const spinnerChar = applyColor(t, tc.toolSpinnerPrefix.color, SPINNER_FRAMES[frame % SPINNER_FRAMES.length]);
        headerLine = `${spinnerChar} ${labelText}${cmdText}`;
      } else if (this.status === "complete") {
        headerLine = `${toolPrefix(t)}${labelText}${cmdText}`;
      } else {
        headerLine = `${errorPrefix(t)}${labelText}${cmdText}`;
      }

      // --- Status footer ---
      let statusLine: string;
      if (this.status === "running") {
        statusLine = branchLine(
          applyColor(t, tc.general.outputColor, "Running..."),
          t
        );
      } else if (this.status === "cancelled") {
        statusLine = branchLine(applyColor(t, tc.toolError.labelColor, "Cancelled"), t);
      } else if (this.status === "error") {
        statusLine = errorLabel(t);
        if (!this.expanded && nonEmptyLines.length > 0) {
          statusLine += expandHint(t);
        }
      } else {
        const count = nonEmptyLines.length > 0
          ? { label: "lines" as const, value: nonEmptyLines.length }
          : undefined;
        const done = doneLabel(t, count);
        statusLine = (!this.expanded && nonEmptyLines.length > 0) ? done + expandHint(t) : done;
      }

      // --- Assemble: header, then status, then output (if expanded) ---
      let display = "\n" + headerLine + "\n" + statusLine;

      if (this.expanded && nonEmptyLines.length > 0) {
        const styled = availableLines.map((l: string) => applyColor(t, tc.general.outputColor, l));
        display += formatExpandedLines(styled, "tail", t);
      }

      // Truncation warning
      const wasTruncated = (this.truncationResult as any)?.truncated || contextTruncation.truncated;
      if (wasTruncated && this.fullOutputPath) {
        display += "\n" + branchLine(
          applyColor(t, tc.toolError.labelColor, `Output truncated. Full output: ${this.fullOutputPath}`),
          t
        );
      }

      cc.addChild(new Text(display, 1, 0));
    };

    // Patch setComplete to clear spinner
    const OrigSetComplete = bashExecProto.setComplete;
    bashExecProto.setComplete = function patchedSetComplete(...args: any[]) {
      clearStyledBashTimer(this);
      return OrigSetComplete.apply(this, args);
    };

    bashExecProto[PATCH_FLAG] = true;
  }

  // --- Register styled tool renderers ---
  // Keep native definitions (including execute and its session context); only override rendering.
  const cwd = process.cwd();

  const readTool = createReadToolDefinition(cwd);
  pi.registerTool({
    ...readTool,
    renderCall(args, theme, ctx) {
      return renderReadCall(args, theme, ctx);
    },
    renderResult(result, options, theme, ctx) {
      return renderReadResult(result, options, theme, ctx);
    },
  });

  const bashTool = createBashToolDefinition(cwd);
  pi.registerTool({
    ...bashTool,
    renderCall(args, theme, ctx) {
      return renderBashCall(args, theme, ctx);
    },
    renderResult(result, options, theme, ctx) {
      return renderBashResult(result, options, theme, ctx);
    },
  });

  const editTool = createEditToolDefinition(cwd);
  pi.registerTool({
    ...editTool,
    renderShell: "default",
    renderCall(args, theme, ctx) {
      return renderEditCall(args, theme, ctx);
    },
    renderResult(result, options, theme, ctx) {
      return renderEditResult(result, options, theme, ctx);
    },
  });

  const writeTool = createWriteToolDefinition(cwd);
  pi.registerTool({
    ...writeTool,
    renderCall(args, theme, ctx) {
      return renderWriteCall(args, theme, ctx);
    },
    renderResult(result, options, theme, ctx) {
      return renderWriteResult(result, options, theme, ctx);
    },
  });

  const grepTool = createGrepToolDefinition(cwd);
  pi.registerTool({
    ...grepTool,
    promptGuidelines: [
      ...(grepTool.promptGuidelines ?? []),
      "Prefer grep/find over bash for file exploration (faster, respects .gitignore)",
    ],
    renderCall(args, theme, ctx) {
      return renderGrepCall(args, theme, ctx);
    },
    renderResult(result, options, theme, ctx) {
      return renderGrepResult(result, options, theme, ctx);
    },
  });

  const findTool = createFindToolDefinition(cwd);
  pi.registerTool({
    ...findTool,
    promptGuidelines: [
      ...(findTool.promptGuidelines ?? []),
      "Prefer grep/find over bash for file exploration (faster, respects .gitignore)",
    ],
    renderCall(args, theme, ctx) {
      return renderFindCall(args, theme, ctx);
    },
    renderResult(result, options, theme, ctx) {
      return renderFindResult(result, options, theme, ctx);
    },
  });

  const lsTool = createLsToolDefinition(cwd);
  pi.registerTool({
    ...lsTool,
    renderCall(args, theme, ctx) {
      return renderLsCall(args, theme, ctx);
    },
    renderResult(result, options, theme, ctx) {
      return renderLsResult(result, options, theme, ctx);
    },
  });
}