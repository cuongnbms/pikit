import { Markdown, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { CONFIG } from "../config.js";
import { hasVisibleContent, currentTheme, applyColor, renderMarkdownWithPadding } from "../utils.js";

function fitToWidth(line: string, width: number): string {
  if (width <= 0) return "";
  return visibleWidth(line) <= width ? line : truncateToWidth(line, width, "");
}

function getPrefix(): string {
  const prefix = currentTheme
    ? applyColor(currentTheme, CONFIG.thinkingMessage.prefixColor, CONFIG.thinkingMessage.prefix)
    : CONFIG.thinkingMessage.prefix;
  return ` ${prefix} `;
}

/** "✻ Thinking…" header row; the thought renders below it, aligned to the prefix. */
function getLabelHeader(prefixText: string): string {
  const label = currentTheme
    ? applyColor(currentTheme, CONFIG.thinkingMessage.labelColor, CONFIG.thinkingMessage.label)
    : CONFIG.thinkingMessage.label;
  return `${prefixText}\x1b[3m${label}\x1b[23m`;
}

export interface ThinkingMessage {
  invalidate(): void;
  render(width: number): string[];
}

export function createThinkingMessage(text: string, markdownTheme: any): ThinkingMessage {
  const sourceMarkdown = markdownTheme instanceof Markdown ? markdownTheme as any : undefined;
  const sourceStyle = sourceMarkdown?.defaultTextStyle;
  const defaultTextStyle = {
    ...sourceStyle,
    color: (t: string) => {
      const base = sourceStyle?.color ? sourceStyle.color(t) : t;
      const colored = currentTheme
        ? applyColor(currentTheme, CONFIG.thinkingMessage.messageColor, base)
        : base;
      return `\x1b[3m${colored}\x1b[23m`;
    },
    italic: sourceStyle?.italic ?? true,
  };
  const md = sourceMarkdown
    ? new Markdown(text, sourceMarkdown.paddingX, sourceMarkdown.paddingY, sourceMarkdown.theme, defaultTextStyle, sourceMarkdown.options)
    : new Markdown(text, 0, 0, markdownTheme, defaultTextStyle);
  // Our prefix already supplies the gap; native paddingX would push the body a column right.
  const preferredPadding = 0;
  let cachedWidth: number | undefined;
  let cachedLines: string[] | undefined;

  function invalidate(): void {
    cachedWidth = undefined;
    cachedLines = undefined;
    md.invalidate();
  }

  function render(width: number): string[] {
    if (cachedLines && cachedWidth === width) return cachedLines;

    if (width <= 0) {
      cachedWidth = width;
      cachedLines = [];
      return cachedLines;
    }

    const prefixText = getPrefix();
    const prefixWidth = visibleWidth(prefixText);
    const isLabelVisible = CONFIG.thinkingMessage.isLabelVisible;

    if (width <= prefixWidth) {
      cachedWidth = width;
      cachedLines = [fitToWidth(prefixText.trim(), width)];
      return cachedLines;
    }

    const mdLines = renderMarkdownWithPadding(md, width - prefixWidth, preferredPadding);
    const paddingPrefix = " ".repeat(prefixWidth);
    // With the label visible the header row owns the prefix; every thought row is padded.
    let prefixPlaced = isLabelVisible;

    const rendered = mdLines.map((line: string) => {
      if (!prefixPlaced && hasVisibleContent(line)) {
        prefixPlaced = true;
        return fitToWidth(`${prefixText}${line}`, width);
      }
      return fitToWidth(`${paddingPrefix}${line}`, width);
    });
    if (isLabelVisible) {
      const first = rendered.findIndex(hasVisibleContent);
      rendered.splice(Math.max(0, first), 0, fitToWidth(getLabelHeader(prefixText), width));
    }

    cachedWidth = width;
    cachedLines = rendered;
    return rendered;
  }

  return { invalidate, render };
}
