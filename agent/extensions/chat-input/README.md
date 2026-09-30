# chat-input

Replaces the default chat input with a configurable, boxed input. All native editor features — cursor movement, history, autocomplete, paste — work normally inside the box.

<img alt="preview" src="https://github.com/user-attachments/assets/4b0acb3d-b163-4d00-a719-0162a7ea79bf" />

## Features

- **Full box border**: With configurable inner spacing
- **Theme-aware borders**: Pulls border colour from your active theme
- **Menu outside box**: Slash menu (`/`) appears below the box
- **Scroll indicators**: Shows `↑ N more` / `↓ N more` when content scrolls
- **Responsive**: Adapts to terminal width; degrades gracefully on narrow terminals
- **Unboxed mode**: Optionally drop side borders for a minimal horizontal-rule look
- **ASCII companion**: Cat ascii companion

## Configuration

User config lives in `~/.pi/agent/configs/chat-input.json`. Create it to override defaults:

```json
{
  "boxedView": false,
  "borderColor": "border",
  "prefix": "❯",
  "prefixColor": "accent",
  "companion": {
    "enabled": true,
    "color": "accent"
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `boxedView` | `boolean` | `true` | `true` = full box with side borders. `false` = top/bottom horizontal rules only, no sides. |
| `boxPadX` | `number` | `1` | Horizontal padding inside the box. |
| `menuGap` | `number` | `0` | Blank lines between bottom border and slash-menu. |
| `extraMenuIndent` | `number` | `1` | Extra indent (spaces) for slash-menu lines. |
| `borderColor` | `string` | `"border"` | Theme colour token **or** hex colour |
| `prefix` | `string` | `"❯"` | Unicode prefix character shown on the first body line. |
| `prefixColor` | `string` | `"accent"` | Theme colour token **or** hex colour |
| `companion.enabled` | `boolean` | `false` | Show a rotating ASCII cat companion above the input. When disabled, top padding is `0`. |
| `companion.color` | `string` | `"accent"` | Theme colour token **or** hex colour for the companion art. |

### Border colour tokens

Any valid theme colour token works. See your active theme in `~/.pi/agent/themes/` or via `/settings → Theme` for available tokens.

Input beginning with `!` uses the theme's `bashMode` colour for the border and prefix. Other input uses the configured border and prefix colours.
