# spinners

Replaces the default **Thinking** verb with a random alternative from a curated list. The complete verb appears immediately and stays fixed throughout each turn, keeping the elapsed-time counter in a stable position.


Default working indicator (single line, animated stars):

```text
✻ Precipitating… (38s · ↓ 1,234 tokens)
```

Token counts are estimates from streamed text, not billed usage. Indicator and message are restored on turn end, agent end and shutdown.

## Features

- **Curated verb list** — Unique alternatives to the default thinking message
- **Claude-style indicator** — Animated star glyphs with inline elapsed time and token estimates
- **Stable label** — Displays the full verb immediately, without character-by-character animation or mid-turn cycling
- **Live status** — Shows elapsed time and estimated token count
- **Theme-aware colors** — Uses pi.dev theme colors with fallbacks
- **Keyboard shortcut hint** — Shows how to expand thinking blocks

## Configuration

Copy the example config and edit it:

```bash
cp ~/.pi/agent/extensions/spinners/spinners.example.json \
   ~/.pi/agent/configs/spinners.json
```

```json
{
  "themeTokens": {
    "verb": "accent",
    "separator": "borderMuted",
    "status": "muted",
    "separatorIcon": "·"
  }
}
```

### Options

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `themeTokens.verb` | `string` | `"accent"` | Theme token for the verb text (e.g., "Boondoggling…") |
| `themeTokens.separator` | `string` | `"borderMuted"` | Theme token for the inline separator |
| `themeTokens.status` | `string` | `"muted"` | Theme token for the status line (elapsed time, token count) |
| `themeTokens.separatorIcon` | `string` | `"·"` | Inline separator between elapsed time and token count |

### Available Theme Tokens

Use any valid pi.dev theme token. Common values:

- `"accent"` — Primary accent color
- `"muted"` — Dimmed/subtle text
- `"borderMuted"` — subtle borders and separators
- `"error"` — Error states
- `"success"` — Success states
- `"warning"` — Warning states

## Verbs

Edit `verbs.ts` to customize the verb list:

```typescript
// Add your own verbs
export const VERBS: readonly string[] = [
  'YourVerbHere',
  // ... existing verbs
];
```

## How It Works

1. **Turn starts** → Picks a random verb and displays it in full
2. **While working** → Keeps the verb fixed; only the star indicator animates
3. **Status updates** → Refreshes elapsed time every second, including between streamed text chunks, and updates estimated token counts as text arrives

