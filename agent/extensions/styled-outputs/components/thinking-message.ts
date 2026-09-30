import { Markdown, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { CONFIG } from "../config.js";
import { hasVisibleContent, currentTheme, applyColor, renderMarkdownWithPadding } from "../utils.js";

function fitToWidth(line: string, width: number): string {
  if (width <= 0) return "";
  return visibleWidth(line) <= width ? line : truncateToWidth(line, width, "");
}

function getFullPrefix(): string {
  const prefix = currentTheme
    ? applyColor(currentTheme, CONFIG.thinkingMessage.prefixColor, CONFIG.thinkingMessage.prefix)
    : CONFIG.thinkingMessage.prefix;
  const label = currentTheme
    ? applyColor(currentTheme, CONFIG.thinkingMessage.labelColor, CONFIG.thinkingMessage.label)
    : CONFIG.thinkingMessage.label;
  return ` ${prefix}${CONFIG.thinkingMessage.isLabelVisible ? ` ${label} ` : ` `}`;
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
  const preferredPadding = (md as any).paddingX ?? 0;
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

    const fullPrefix = getFullPrefix();
    const firstLinePrefixWidth = visibleWidth(fullPrefix);

    if (width <= firstLinePrefixWidth) {
      cachedWidth = width;
      cachedLines = [fitToWidth(fullPrefix.trim(), width)];
      return cachedLines;
    }

    const mdLines = renderMarkdownWithPadding(md, width - firstLinePrefixWidth, preferredPadding);
    const paddingPrefix = " ".repeat(firstLinePrefixWidth);
    let prefixPlaced = false;

    const rendered = mdLines.map((line: string) => {
      if (!prefixPlaced && hasVisibleContent(line)) {
        prefixPlaced = true;
        return fitToWidth(`${fullPrefix}${line}`, width);
      }
      return fitToWidth(`${paddingPrefix}${line}`, width);
    });

    cachedWidth = width;
    cachedLines = rendered;
    return rendered;
  }

  return { invalidate, render };
}
