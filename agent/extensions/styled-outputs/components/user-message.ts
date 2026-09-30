import { Markdown, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { CONFIG } from "../config.js";
import { hasVisibleContent, currentTheme, applyColor } from "../utils.js";

function userPrefix(): string {
  const prefix = currentTheme
    ? applyColor(currentTheme, CONFIG.userMessage.color, CONFIG.userMessage.prefix)
    : CONFIG.userMessage.prefix;
  return ` ${prefix} `;
}

function fitToWidth(line: string, width: number): string {
  if (width <= 0) return "";
  return visibleWidth(line) <= width ? line : truncateToWidth(line, width, "");
}

export interface UserMessage {
  invalidate(): void;
  render(width: number): string[];
}

export function createUserMessage(text: string, markdownTheme: any): UserMessage {
  const md = markdownTheme instanceof Markdown
    ? markdownTheme
    : new Markdown(text, 0, 0, markdownTheme, {
      color: (t: string) => {
        if (!currentTheme) return t;
        return applyColor(currentTheme, CONFIG.userMessage.bodyColor, t);
      },
    });
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

    const prefixText = userPrefix();
    const prefixWidth = visibleWidth(prefixText);

    if (width <= prefixWidth) {
      cachedWidth = width;
      cachedLines = [fitToWidth(prefixText.trim(), width)];
      return cachedLines;
    }

    const mdLines = md.render(width - prefixWidth);
    const paddingPrefix = " ".repeat(prefixWidth);
    let prefixPlaced = false;

    const rendered = mdLines.map((line: string) => {
      if (!prefixPlaced && hasVisibleContent(line)) {
        prefixPlaced = true;
        return fitToWidth(`${prefixText}${line}`, width);
      }
      return fitToWidth(`${paddingPrefix}${line}`, width);
    });

    cachedWidth = width;
    cachedLines = rendered;
    return rendered;
  }

  return { invalidate, render };
}