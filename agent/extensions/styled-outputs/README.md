# styled-outputs

Custom styled rendering for every message type in pi — assistant messages, user messages, thinking blocks, tool executions, skill invocations, and custom tools. The defaults mirror Claude Code's transcript style:

```
 > fix the build
 ● I'll check the config first.

 ● Read(package.json)
   ⎿  Read 42 lines (ctrl+o to expand)

 ● Bash(pnpm test)
   ⎿  PASS a.test
      PASS b.test
      PASS c.test
      … +12 lines (ctrl+o to expand)

 ● Update(src/foo.ts)
   ⎿  Updated src/foo.ts with 1 addition and 1 removal
       10 const a = 1;
      -11 const b = 2;
      +11 const b = 3;
```

https://github.com/user-attachments/assets/6bcf414f-9114-405e-af9e-392a8f4e8bdc


## Features

- **Assistant messages** — Prefixed lines with configurable icon and colour
- **User messages** — `>` prompt prefix; optional theme background toggle
- **Thinking blocks** — `✻ Thinking…` header row with the thought below it (label can be hidden)
- **Tool executions** — `● Tool(args)` headers with a `⎿` status row for `read`, `bash`, `edit` (`Update`), `write`, `grep`/`find` (`Search`), `ls` (`List`), and custom tools; the dot turns red on error
- **Collapsed previews** — Bash, Write and custom tool results show their first lines plus `… +N lines (ctrl+o to expand)`
- **Diff viewer** — `edit` shows "Updated … with N additions and M removals" and the diff without expanding; long diffs trim at `maxExpandedLines`
- **Skill invocations** — `● Skill(name)` blocks, expandable to the skill content
- **Custom messages** — Expandable custom messages with prefix icon, title, and content; all custom messages get styled output regardless of registered renderers
- **Tool spinner** — Animated character spinner while tools are running
- **Bash execution** — `!` commands render as `! cmd`, `!!` commands (no context) as `!! cmd`, with output under `⎿`
- **Group-aware config** — Override any general tool setting per group (`base`, `custom`); unset properties fall through to `general`
- **Theme-aware colours** — All colour fields accept pi theme tokens (`"accent"`, `"dim"`, etc.) or hex values (`"#ff6347"`)
- **Expand/collapse** — Tool outputs and skill blocks collapse by default; expand with a keypress

## Configuration

Copy the example config and edit it:

```bash
cp ~/.pi/agent/extensions/styled-outputs/styled-outputs.example.json \
   ~/.pi/agent/configs/styled-outputs.json
```

All fields are optional — omit any field to keep its default.

### Assistant message

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `assistantMessage.prefix` | `string` | `"●"` | Prefix icon on the first line of content |
| `assistantMessage.color` | `string` | `"text"` | Colour for the prefix icon (theme token or hex) |

### User message

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `userMessage.prefix` | `string` | `">"` | Prefix icon on the first line |
| `userMessage.color` | `string` | `"dim"` | Colour for the prefix icon |
| `userMessage.bodyColor` | `string` | `"text"` | Colour for message body text |
| `userMessage.isThemeBackgroundVisible` | `boolean` | `true` | Keep the default theme background behind user messages |

### Thinking message

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `thinkingMessage.prefix` | `string` | `"✻"` | Prefix icon character |
| `thinkingMessage.prefixColor` | `string` | `"muted"` | Colour for the prefix icon |
| `thinkingMessage.label` | `string` | `"Thinking…"` | Label text shown after the prefix when `isLabelVisible` is `true` |
| `thinkingMessage.labelColor` | `string` | `"muted"` | Colour for the label text |
| `thinkingMessage.isLabelVisible` | `boolean` | `true` | Show the label on its own header row |
| `thinkingMessage.messageColor` | `string` | `"dim"` | Colour for thinking content |

> **Note:** When `isLabelVisible` is `true`, the label sits on its own header row (` ✻ Thinking…`) and every thought row aligns to the prefix width. When `false`, the prefix goes on the first thought row.

### Skill invocation

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `skills.prefix` | `string` | `"●"` | Prefix icon |
| `skills.prefixColor` | `string` | `"success"` | Colour for the prefix |
| `skills.titleColor` | `string` | `"toolTitle"` | Colour for the skill title |
| `skills.nameColor` | `string` | `"text"` | Colour for the skill name inside `Skill(…)` |
| `skills.labelColor` | `string` | `"text"` | Colour for the status label ("Loaded") |
| `skills.expandHintColor` | `string` | `"dim"` | Colour for the expand/collapse hint |
| `skills.outputColor` | `string` | `"dim"` | Colour for expanded content |

### Custom message

Styled rendering for all custom messages. Custom messages registered via `pi.registerMessageRenderer()` are also styled by this extension — the registered renderer is ignored in favor of consistent styled output.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `customMessages.prefix` | `string` | `"●"` | Prefix icon |
| `customMessages.prefixColor` | `string` | `"success"` | Colour for the prefix |
| `customMessages.titleColor` | `string` | `"toolTitle"` | Colour for the message title (bold) |
| `customMessages.nameColor` | `string` | `"text"` | Unused since the title became the header; kept for config compatibility |
| `customMessages.labelColor` | `string` | `"text"` | Colour for the status label ("Done") |
| `customMessages.expandHintColor` | `string` | `"dim"` | Colour for the expand/collapse hint |
| `customMessages.outputColor` | `string` | `"dim"` | Colour for expanded content |

### Bash execution (! and !! commands)

`!` and `!!` commands share the same visual pattern as tool executions:

- **`!` commands** — header `! cmd` (output is included in LLM context)
- **`!!` commands** — header `!! cmd` (output runs in background, excluded from context)

Both show output under a `⎿` branch: a short preview while collapsed, the full (trimmed) output when expanded. Errors show `Error: Exit N` on the branch.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `bashExecution.titleColor` | `string` | `"bashMode"` | Colour for the `!` / `!!` marker |

### Tool execution

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `tools.toolSpinnerPrefix.prefixChars` | `string[]` | `["·","✢","✳","✶","✻","✽"]` | Characters cycling in the loading spinner |
| `tools.toolSpinnerPrefix.color` | `string` | `"muted"` | Colour for the spinner |
| `tools.toolSuccess.prefix` | `string` | `"●"` | Icon for successful tool runs |
| `tools.toolSuccess.prefixColor` | `string` | `"success"` | Colour for the success icon |
| `tools.toolSuccess.labelColor` | `string` | `"text"` | Colour for the status text (e.g. "Read 12 lines") |
| `tools.toolError.prefix` | `string` | `"●"` | Icon for failed tool runs |
| `tools.toolError.prefixColor` | `string` | `"error"` | Colour for the error icon |
| `tools.toolError.labelColor` | `string` | `"error"` | Colour for the error label (status line) |
| `tools.toolBranch.prefix` | `string` | `"  ⎿ "` | Icon before the status line; its width sets the output indent |
| `tools.toolBranch.color` | `string` | `"dim"` | Colour for the branch icon |

### Tool general settings

These apply to all tool types unless overridden by a group.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `tools.general.titleColor` | `string` | `"toolTitle"` | Colour for tool titles |
| `tools.general.summaryColor` | `string` | `"text"` | Colour for the tool arguments inside `Tool(…)` |
| `tools.general.countColor` | `string` | `"muted"` | Unused since counts moved into the status text; kept for config compatibility |
| `tools.general.expandHintColor` | `string` | `"dim"` | Colour for expand/collapse hints |
| `tools.general.outputColor` | `string` | `"dim"` | Colour for tool output text |
| `tools.general.maxExpandedLines` | `number` | `40` | Max lines shown when a tool result is expanded (also trims inline Edit diffs) |
| `tools.general.collapsedPreviewLines` | `number` | `3` | Output lines previewed while a Bash, Write or custom tool result is collapsed (`0` = hint only) |
| `tools.general.moreColor` | `string` | `"muted"` | Colour for "more" separator text |
| `tools.general.moreBgColor` | `string` | `"borderMuted"` | Background colour for the "more" separator |
| `tools.general.isThemeBackgroundVisible` | `boolean` | `false` | Apply theme background behind tool blocks, skill invocations, and custom messages |
| `tools.general.verticalPadding` | `number` | `0` | Vertical padding inside tool content boxes (0 = compact, core default = 1) |
| `tools.general.horizontalPadding` | `number` | `1` | Horizontal padding inside tool content boxes (left+right indent; core default = 1) |
| `tools.general.diffAddedColor` | `string` | `"toolDiffAdded"` | Colour for diff added lines |
| `tools.general.diffRemovedColor` | `string` | `"toolDiffRemoved"` | Colour for diff removed lines |
| `tools.general.diffContextColor` | `string` | `"toolDiffContext"` | Colour for diff context lines |
| `tools.general.maxDiffFileSize` | `string\|number` | `"1MB"` | Skip diff rendering for files exceeding this size |

### Tool groups

Any `tools.general` key can be overridden per group. Unset properties fall through to `general`.

| Key | Description |
|-----|-------------|
| `tools.groups.base` | Built-in tool renderers (`read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`) |
| `tools.groups.custom` | Any other (custom) tool |

Example — give custom tools a different title colour and expanded line limit:

```json
{
  "tools": {
    "groups": {
      "custom": {
        "titleColor": "#c07898",
        "maxExpandedLines": 20
      }
    }
  }
}
```

### Colour values

Every colour field accepts either:

- A **pi theme token** — e.g. `"accent"`, `"dim"`, `"muted"`, `"success"`, `"error"`, `"warning"`, `"borderMuted"`, `"toolTitle"`, `"toolDiffAdded"`, `"toolDiffRemoved"`, `"toolDiffContext"`
- A **hex colour** — e.g. `"#ff6347"`, `"#c07898"`

Theme tokens adapt to your active theme automatically.

## How it works

The extension patches pi's built-in message components (`AssistantMessage`, `UserMessage`, `ToolExecution`, `SkillInvocationMessage`, `CustomMessage`, `BashExecution`) at prototype level. A `Symbol.for` patch flag prevents double-patching on reload.

For `BashExecutionComponent`, the extension listens to the `user_bash` event to determine whether a command is `!` (Command) or `!!` (Shell), then patches `updateDisplay` to strip borders and apply the styled header/status/output format.

Tool renderers are registered via `pi.registerTool()` for built-in tools (`read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`) — each with custom call and result renderers. For any other tool, the extension patches `getCallRenderer` / `getResultRenderer` to provide a fallback renderer when no built-in renderer exists.

All rendering uses factory functions + closures (no classes). Derived values like prefix widths and padding are computed from config — change a prefix icon and the alignment adjusts automatically.

## Structure

```
styled-outputs/
├── styled-outputs.example.json
├── index.ts                # Extension entry point, patching & tool registration
├── config.ts               # Defaults + user config loading
├── types.ts                # TypeScript interfaces for user config
├── utils.ts                # Colour helpers, ANSI utilities, path shortening
└── components/
    ├── assistant-message.ts # Assistant message renderer
    ├── thinking-message.ts # Thinking block renderer
    ├── user-message.ts     # User message renderer
    ├── skill-message.ts    # Skill invocation renderer
    ├── custom-message.ts   # Custom message renderer
    ├── base-renderer.ts    # Built-in tool call/result renderers
    ├── fallback-renderer.ts # Fallback call/result renderer for unknown tools
    ├── markdown-result.ts  # Shared markdown result renderer
    └── tool-shared.ts      # Group config resolution, spinner, branch/indent helpers
```