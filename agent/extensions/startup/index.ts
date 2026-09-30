import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getKeybindings } from "@earendil-works/pi-tui";
import { discoverLoadedCounts } from "./discovery.js";
import { renderBox } from "./layout.js";
import type { KeyMap } from "./layout.js";

export default function startup(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;

    const counts = discoverLoadedCounts(pi.getCommands());
    const kb = getKeybindings();
    const keyMap: KeyMap = {
      "app.model.cycleForward": kb.getKeys("app.model.cycleForward")[0] ?? "ctrl+p",
      "app.thinking.cycle": kb.getKeys("app.thinking.cycle")[0] ?? "shift+tab",
    };

    ctx.ui.setHeader((_tui, theme) => ({
      render(termWidth: number): string[] {
        return renderBox(theme, counts, termWidth, keyMap);
      },
      invalidate() {},
    }));
  });
}
