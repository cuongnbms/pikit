import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { FooterUserConfig, StatusLineSegmentId, ColorScheme, StatusLineSegmentOptions } from "./types.js";
import { getDefaultColors } from "./theme.js";
import type { IconSet } from "./icons.js";

// Compact one-row defaults; custom configs can still opt into two rows.
const DEFAULT_ROW1_LEFT: StatusLineSegmentId[] = ["path", "separator", "git", "separator", "model", "text:⚡", "thinking"];
const DEFAULT_ROW1_RIGHT: StatusLineSegmentId[] = ["context_pct", "separator", "token_compact", "separator", "cost"];
const DEFAULT_ROW2_LEFT: StatusLineSegmentId[] = [];
const DEFAULT_ROW2_RIGHT: StatusLineSegmentId[] = [];
const DEFAULT_ICONS: Partial<IconSet> = { separator: "·", folder: "📂", branch: "" };

const DEFAULT_SEGMENT_OPTIONS: StatusLineSegmentOptions = {
  model: { label: "id", showProvider: true },
  contextBar: {
    barWidth: 8,
    filledChar: "▰",
    unfilledChar: "▱",
    colorMode: "threshold",
    compactLabel: true,
  },
  path: { mode: "basename" },
  git: {
    showBranch: true,
    showStaged: true,
    showUnstaged: true,
    showUntracked: true,
  },
};

// Cache for user config
let userConfigCache: FooterUserConfig | null = null;
let userConfigCacheTime = 0;
let userConfigCachePath: string | undefined;
const CACHE_TTL = 5000; // 5 seconds

function getConfigPath(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  return join(homeDir, ".pi", "agent", "configs", "footer.json");
}

export function loadUserConfig(): FooterUserConfig | null {
  const now = Date.now();
  const configPath = getConfigPath();
  // Cache misses and parse errors too, but never reuse another HOME's config.
  if (userConfigCachePath === configPath && now - userConfigCacheTime < CACHE_TTL) {
    return userConfigCache;
  }

  userConfigCachePath = configPath;
  try {
    if (existsSync(configPath)) {
      const content = readFileSync(configPath, "utf-8");
      const parsed = JSON.parse(content);
      userConfigCache = parsed as FooterUserConfig;
      userConfigCacheTime = now;
      return userConfigCache;
    }
  } catch {
    // Ignore errors, return null
  }

  userConfigCache = null;
  userConfigCacheTime = now;
  return null;
}

export function clearUserConfigCache(): void {
  userConfigCache = null;
  userConfigCacheTime = 0;
  userConfigCachePath = undefined;
}

export function getEffectiveConfig(): {
  row1LeftSegments: StatusLineSegmentId[];
  row1RightSegments: StatusLineSegmentId[];
  row2LeftSegments: StatusLineSegmentId[];
  row2RightSegments: StatusLineSegmentId[];
  colors: ColorScheme;
  segmentOptions: StatusLineSegmentOptions;
  icons: Partial<IconSet>;
} {
  const userConfig = loadUserConfig();

  return {
    row1LeftSegments: userConfig?.row1LeftSegments ?? DEFAULT_ROW1_LEFT,
    row1RightSegments: userConfig?.row1RightSegments ?? DEFAULT_ROW1_RIGHT,
    row2LeftSegments: userConfig?.row2LeftSegments ?? DEFAULT_ROW2_LEFT,
    row2RightSegments: userConfig?.row2RightSegments ?? DEFAULT_ROW2_RIGHT,
    colors: userConfig?.colors ?? getDefaultColors(),
    segmentOptions: {
      model: { ...DEFAULT_SEGMENT_OPTIONS.model, ...userConfig?.segmentOptions?.model },
      path: { ...DEFAULT_SEGMENT_OPTIONS.path, ...userConfig?.segmentOptions?.path },
      git: { ...DEFAULT_SEGMENT_OPTIONS.git, ...userConfig?.segmentOptions?.git },
      contextBar: { ...DEFAULT_SEGMENT_OPTIONS.contextBar, ...userConfig?.segmentOptions?.contextBar },
    },
    icons: { ...DEFAULT_ICONS, ...userConfig?.icons },
  };
}
