import type { Theme } from "@earendil-works/pi-coding-agent";
import { VERSION } from "@earendil-works/pi-coding-agent";
import { visibleWidth, truncateToWidth } from "@earendil-works/pi-tui";

import { bold, centerText, fitToWidth, hasNerdFonts } from "./helpers.js";
import type { StartupCounts } from "./discovery.js";

const PI_ART = [
  "██████╗ ██╗",
  "██╔══██╗██║",
  "██████╔╝██║",
  "██╔═══╝ ██║",
  "╚═╝     ╚═╝",
];

function buildLeftColumn(theme: Theme, colWidth: number): string[] {
  return [
    "",
    ...PI_ART.map((line) => centerText(bold(theme.fg("accent", line)), colWidth)),
  ];
}

export interface KeyMap {
  "app.model.cycleForward": string;
  "app.thinking.cycle": string;
}

function buildTipsColumn(theme: Theme, keyMap: KeyMap): string[] {
  const dim = (s: string) => theme.fg("dim", s);
  const modelKey = keyMap["app.model.cycleForward"];
  const thinkingKey = keyMap["app.thinking.cycle"];
  return [
    "",
    ` ${dim("/")} for commands`,
    ` ${dim("!")} to run bash`,
    ` ${dim(modelKey)} cycle model`,
    ` ${dim(thinkingKey)} cycle thinking`,
  ];
}

function buildRightColumn(theme: Theme, counts: StartupCounts): string[] {
  const { models, modelSource, contextFiles, extensions, skills, promptTemplates } = counts;
  const item = (n: number, label: string, estimate = false) =>
    ` ${theme.fg("dim", "• ")}${theme.fg(n > 0 ? "success" : "dim", `${estimate ? "~" : ""}${n}`)} ${label}`;
  const countLines: string[] = [];
  if (models !== undefined && modelSource) {
    countLines.push(item(models, `${modelSource} model${models !== 1 ? "s" : ""}`));
  }
  // Filesystem discovery cannot prove loading succeeded, was enabled, or trusted.
  countLines.push(
    item(extensions, `configured extension${extensions !== 1 ? "s" : ""}`, true),
    item(skills, `registered skill${skills !== 1 ? "s" : ""}`),
    item(promptTemplates, `registered template${promptTemplates !== 1 ? "s" : ""}`),
    item(contextFiles, `configured context file${contextFiles !== 1 ? "s" : ""}`, true),
  );
  return ["", ...countLines, ""];
}

export function renderBox(
  theme: Theme,
  counts: StartupCounts,
  termWidth: number,
  keyMap: KeyMap,
): string[] {
  const minLayoutWidth = 44;
  if (termWidth < minLayoutWidth) return [];

  const boxWidth = Math.min(termWidth, Math.max(76, Math.min(termWidth - 2, 82)));
  const leftCol = 20;
  const configCol = 32;
  const tipsCol = Math.max(1, boxWidth - leftCol - configCol - 2);
  const hChar = "─";
  const nerd = hasNerdFonts();
  const separator = (s: string) => { try { return theme.fg("separator" as any, s); } catch { return theme.fg("dim", s); } };
  const dim = (s: string) => theme.fg("dim", s);

  const leftLines = buildLeftColumn(theme, leftCol);
  const configLines = buildRightColumn(theme, counts);
  const tipsLines = buildTipsColumn(theme, keyMap);

  const lines: string[] = [];
  lines.push("");

  const icon = nerd ? "\uE22C" : "";
  const title = truncateToWidth(theme.fg("accent", icon) + dim(` pi.dev agent v${VERSION} `), boxWidth - 4);
  lines.push(separator("╭──") + title + separator(hChar.repeat(boxWidth - 4 - visibleWidth(title))) + separator("╮"));

  if (termWidth < 76) {
    // Three fixed columns do not fit small terminals. Keep resource provenance
    // and tips, stacked, rather than overflowing or truncating estimate labels.
    for (const line of [...configLines, ...tipsLines.slice(1), ""]) {
      lines.push(separator("│") + fitToWidth(line, boxWidth - 2) + separator("│"));
    }
  } else {
    const maxRows = Math.max(leftLines.length, configLines.length, tipsLines.length);
    for (let i = 0; i < maxRows; i++) {
      const left   = fitToWidth(leftLines[i]   ?? "", leftCol);
      const config = fitToWidth(configLines[i] ?? "", configCol);
      const tips   = fitToWidth(tipsLines[i]   ?? "", tipsCol);
      lines.push(separator("│") + left + config + tips + separator("│"));
    }
  }

  lines.push(separator("╰") + separator(hChar.repeat(boxWidth - 2)) + separator("╯"));
  lines.push("");

  return lines;
}
