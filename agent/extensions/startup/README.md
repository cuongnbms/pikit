# startup

A startup header for the pi coding agent. Displays a welcome box at session start showing the pi logo, runtime model/command counts, configured filesystem estimates, and quick keyboard shortcuts.

<img alt="preview" src="https://github.com/user-attachments/assets/18d9730b-7df1-48a5-b91e-404454bcb06f" />

## Features

- **Pi logo**: ASCII art rendered in the accent colour
- **Runtime counts**: Resolved scoped models (or available registry models), plus registered skills and templates
- **Configured estimates**: Filesystem extension/context candidates are explicitly labelled `~N configured …`, not loaded or active
- **Quick tips**: Command and bash input reminders, plus model and thinking shortcuts
- **Version banner**: Agent version shown in the top border
- **Responsive layout**: Three columns from 76 columns; resource counts and tips stack at 44–75 columns; hidden below 44 columns
- **Nerd Font icons**: Uses Nerd Font glyphs where available, falls back to plain Unicode symbols automatically

## What it shows

| Column | Content |
|--------|---------|
| Left | Pi ASCII art logo |
| Centre | Scoped/available model counts, registered skills/templates, configured extension/context estimates |
| Right | Keyboard shortcuts |

## Counts and estimate discovery

Counts are a startup snapshot, not a claim that every filesystem candidate loaded.
An empty `ctx.scopedModels` means all available models; model globs in settings are
never counted. Hosts without an available-model API omit the model count.

Filesystem estimates can include untrusted, disabled, or failed-to-load local
resources, and may miss CLI additions, custom agent paths, inherited context, or
unsupported package sources. Package `extensions: []` and supported filters are
honoured. Trust/loading success cannot be inferred from files on disk. Runtime
command counts remain accurate for the registry entries (deduplicated by name).

| Type | Source |
|------|--------|
| Models | `ctx.scopedModels` resolved runtime scope when nonempty; otherwise `ctx.modelRegistry.getAvailable()` |
| Context files (configured estimate) | `~/.pi/agent/AGENTS.md`, `~/.claude/AGENTS.md`, `<cwd>/AGENTS.md`, `<cwd>/CLAUDE.md`, `<cwd>/.pi/AGENTS.md` |
| Extensions (configured estimate) | `~/.pi/agent/settings.json`, `<cwd>/.pi/settings.json` (each package's `package.json` `pi.extensions` manifest — glob-expanded, with `!`/`+`/`-` overrides — under `npm/node_modules/<name>` and `git/<host>/<path>`, user + project scope; packages with no manifest fall back to a convention `extensions/` dir; object-form entries may additionally filter via an `extensions` array, where `[]` disables all), plus local dirs `~/.pi/agent/extensions/`, `<cwd>/.pi/extensions/`, `<cwd>/extensions/` (smart discovery: flat `.ts`/`.js` files and `index.ts` subdirs, mirroring pi's `collectAutoExtensionEntries`) |
| Registered skills | pi command registry — `pi.getCommands()` with `source: "skill"` (local + package-installed) |
| Registered templates | pi command registry — `pi.getCommands()` with `source: "prompt"` (local + package-installed) |

## Icons

Nerd Font icons are auto-detected from your terminal. Ghostty, WezTerm, Kitty, iTerm2, and Alacritty are recognised automatically — everything else falls back to plain Unicode symbols. If detection gets it wrong (e.g. when running inside tmux), override it:

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
