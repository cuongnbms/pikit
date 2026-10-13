# footer

A customizable one- or two-row footer for the pi coding agent. Provides a rich status bar at the bottom of the terminal showing model info, git status, token usage, and more.

<img alt="preview" src="https://github.com/user-attachments/assets/b0e90d1b-2f93-4a94-a373-94d2f85d6bf8" />


## Layout

```
Row 1 left:  📂 <path> · <branch> <dirty> · <model id> (<provider>) ⚡ <level>
Row 1 right: <context bar> <pct%>/<max tokens> · ↑<in> ↓<out> cache <hit-rate>% · $<cost>
Row 2:      empty by default
```

When both row 2 lists are empty, the footer renders row 1 only, with no blank
line or divider above it (see [One-row layout](#one-row-layout)).

## Features

- **Compact one-row default**: Project, git, model/provider, thinking and usage on one line; two-row layouts remain configurable
- **Context bar**: 8-character threshold-coloured bar by default, with configurable width, colours and % indicator
- **Git integration**: Shows current branch and working tree status (staged, unstaged, untracked)
- **Token tracking**: Composite `T:` line with total, cache-read count, cache hit rate, input, and output counts
- **Thinking level**: Lowercase selected level name with per-level colour
- **Virtual routing**: The `model` segment adds `→ <physical model> (<provider>) • <routed thinking>` after a response on the current session branch. Ordinary models and virtual selections without a response keep the concise selected-model display.
- **Nerd Font support**: Automatic detection with ASCII fallbacks
- **Live updates**: Git status refreshes automatically as you work

## Configuration

Create `~/.pi/agent/configs/footer.json` to customise the footer. Each row's
left and right segments are configured independently:

```json
{
  "row1LeftSegments":  ["pi", "separator", "model", "text:⚡", "thinking", "separator", "path", "git"],
  "row1RightSegments": [],
  "row2LeftSegments":  ["context_pct"],
  "row2RightSegments": ["token_total", "separator", "cost"],

  "colors": {
    "model": "#c07898",
    "thinkingHigh": "#afb9fe",
    "separator": "#87827a"
  },

  "segmentOptions": {
    "path": { "mode": "basename" },
    "git": {
      "showBranch": true,
      "showStaged": true,
      "showUnstaged": true,
      "showUntracked": true
    }
  }
}
```

See `footer.example.json` in this directory for the compact defaults. The two-row configuration above is an optional alternative.

## Available Segments

| Segment | Description | Notes |
|---------|-------------|-------|
| `pi` | π symbol in accent blue | — |
| `model` | Selected model id/name + `(provider)`, with physical route for virtual models | `segmentOptions.model`: `label` `"name"` · `"id"` (default); `showProvider` (bool, default `true`). Options apply to the selected model, not the route. Route uses the latest current-branch assistant's recorded provider/model/thinking; missing routed thinking is omitted, never inferred from the selected level |
| `path` | Current working directory | `segmentOptions.path.mode`: `"basename"` (default) · `"abbreviated"` · `"full"` |
| `git` | Git branch and dirty indicators | `showBranch`, `showStaged`, `showUnstaged`, `showUntracked` (all bool) |
| `context_pct` | Gradient bar + `X.X%` + max tokens | Bar fully configurable via `segmentOptions.contextBar` (see below). % and max tokens use `contextLabel` colour. Max tokens formatted with K/M suffix (e.g. `128k`, `2M`). Set `DEBUG_PCT` in `context.ts` to a number (0–100) to pin the bar at a fixed value for visual testing. |
| `cost` | `$<amount>` | `$` dim, amount in `cost` colour (`muted` by default) |
| `thinking` | `<level>` | Lowercase level with per-level colour; always visible |
| `token_total` | `T: <total> (<cache-read> cached, <hit-rate>% hit) ↑ <in> ↓ <out>` | Hit rate is `cacheRead / (input + cacheRead + cacheWrite)`; labels are dim and numbers use the `tokens` colour |
| `token_compact` | `↑<in> ↓<out> cache <hit-rate>%` | Short form of `token_total` for one-row layouts; hit rate rounded to a whole percent |
| `token_in` | Input tokens | Available for custom layouts |
| `token_out` | Output tokens | Available for custom layouts |
| `cache_read` | Cache read tokens (hidden if zero) | — |
| `cache_write` | Cache write tokens (hidden if zero) | — |
| `context_total` | Total context window size | — |
| `separator` | `·` divider by default | Coloured via `separator` in `colors`; override via `icons.separator` |
| `text:...` | Literal text, e.g. `text:⚡` | — |

## Branch and route accounting

Usage/cost totals include all session entries, including abandoned branches. Virtual
route identity is separate: it comes only from assistant messages on the active
branch, after its latest model-selection entry, and only when that recorded
provider/model matches the live virtual selection. Navigating into another
selection's history keeps the selected-only display. Switching branch/session or
selecting a new model invalidates the cached route. Before that selection has a
response, only its selected model is shown. The separate `thinking` segment
continues to show the live selected level, not the physical response's level.

Route lookup shares the session-stat cache (manager/session/leaf/count/model);
unchanged frames do not rescan branch history. Ordinary models never need a route
scan. Physical routes become visible once the assistant message is persisted;
`message_end` invalidates accounting while the host finalizes the response.

## Context Bar

The `context_pct` segment's bar is fully configurable via `segmentOptions.contextBar`:

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `barWidth` | number | `8` | Number of characters wide |
| `filledChar` | string | `"▰"` | Character used for the filled portion |
| `unfilledChar` | string | `"▱"` | Character used for the unfilled portion |
| `unfilledColor` | color | `"#4e4c49"` | Color of the unfilled portion — hex or pi theme token |
| `gradientStart` | color | `"#f29373"` | Gradient color at the left/empty end — hex or pi theme token |
| `gradientMid` | color | `"#d67858"` | Gradient midpoint color — hex or pi theme token |
| `gradientEnd` | color | `"#ae4f2f"` | Gradient color at the right/full end — hex or pi theme token |
| `gradientMidPoint` | number | `0.55` | Where `gradientMid` sits along the bar (0–1). Below this fraction the gradient runs start→mid; above it mid→end |
| `colorMode` | `"gradient"` \| `"threshold"` | `"threshold"` | `threshold` ignores the gradient: the filled cells and the % use `contextLabel` below `warnAt`, `contextWarn` from `warnAt`, `contextError` from `errorAt` |
| `warnAt` | number | `60` | Percent where `threshold` mode turns to `contextWarn` |
| `errorAt` | number | `85` | Percent where `threshold` mode turns to `contextError` |
| `compactLabel` | boolean | `true` | Label as `40%/500k` (whole percent, dim window) instead of `40.0% / 500k` |

All color fields accept either a hex string (e.g. `"#ff6347"`) or a pi theme token (e.g. `"accent"`, `"warning"`, `"dim"`).

```json
{
  "segmentOptions": {
    "contextBar": {
      "barWidth": 20,
      "unfilledColor": "dim",
      "gradientStart": "#56b6c2",
      "gradientMid": "#61afef",
      "gradientEnd": "#c678dd",
      "gradientMidPoint": 0.4
    }
  }
}
```

## One-row layout

This is the source default: leave both row 2 lists empty and put everything on row 1. No custom config is needed. This pairs with
`chat-input`'s `"boxedView": false`, so the input's bottom rule sits directly
above the footer:

```json
{
  "row1LeftSegments":  ["path", "separator", "git", "separator", "model", "text:⚡", "thinking"],
  "row1RightSegments": ["context_pct", "separator", "token_compact", "separator", "cost"],
  "row2LeftSegments":  [],
  "row2RightSegments": [],
  "icons": { "separator": "·", "folder": "📂", "branch": "" },
  "segmentOptions": {
    "model": { "label": "id", "showProvider": true },
    "contextBar": {
      "barWidth": 8, "filledChar": "▰", "unfilledChar": "▱",
      "colorMode": "threshold", "compactLabel": true
    }
  }
}
```

```
📂 agentkit · main *3 +1 · grok-4.7 (xai) ⚡ medium ▰▱▱▱▱▱▱▱ 5%/500k · ↑25k ↓1.3k cache 74% · $0.10
```

## Thinking Levels

The `thinking` segment shows per-level colours:

| Level | Display | Default colour |
|-------|---------|---------------|
| `off` | `off` | dim |
| `minimal` | `minimal` | muted |
| `low` | `low` | warning |
| `medium` | `medium` | success |
| `high` | `high` | `#afb9fe` |
| `xhigh` | `xhigh` | rainbow gradient |
| `max` | `max` | rainbow gradient |

Override any level colour via the corresponding key in `colors`. Setting `thinkingXhigh` or `thinkingMax` replaces the rainbow gradient with a solid colour:

```json
{
  "colors": {
    "thinkingXhigh": "#9575cd",
    "thinkingMax": "#ce93d8"
  }
}
```

## Git Status Indicators

The `git` segment shows:
- Branch name coloured green (clean) or amber (dirty)
- `*N` — unstaged changes
- `+N` — staged changes
- `?N` — untracked files

## Icons

The folder defaults to `📂`, the separator to `·`, and the branch icon is hidden. The default layout includes `⚡` before thinking. Other Nerd Font icons are auto-detected from your terminal. Ghostty, WezTerm, Kitty, iTerm2, Alacritty, Foot, Rio, and Contour are recognised automatically — everything else falls back to plain Unicode symbols. If detection gets it wrong (e.g. when running inside tmux), override it:

```bash
export FOOTER_NERD_FONTS=1  # force Nerd Fonts on
export FOOTER_NERD_FONTS=0  # force plain icons
```

### Installing a Nerd Font (macOS)

```bash
brew install --cask font-jetbrains-mono-nerd-font
```

Other fonts available via `brew search nerd-font`.

### Configuring iTerm2

1. Open **Settings → Profiles → Text**
2. Set **Font** to `JetBrainsMonoNL Nerd Font Propo`, size `10` (recommended)
3. Enable **Use a different font for non-ASCII text** and set the same font there — required for icons to render correctly

### Custom Icons

To swap out any icon, add an `icons` key to your `~/.pi/agent/configs/footer.json`. Browse available Nerd Font glyphs at [nerdfonts.com/cheat-sheet](https://www.nerdfonts.com/cheat-sheet):

```json
{
  "icons": {
    "branch": "",
    "separator": "|"
  }
}
```
