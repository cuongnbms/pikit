import { CustomEditor, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { TUI, EditorTheme } from "@earendil-works/pi-tui";
import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { CONFIG, COMPANION_PADDING, MIN_WIDTH_FOR_COMPANION } from "./config.js";
import { applyColor, CompanionAnimator } from "./utils.js";

// ─── Helpers ──────────────────────────────────────────────────────────────
const ANSI_RE = /\x1b\[[0-9;]*m|\x1b\[0?m/g;

function plainText(line: string): string {
	return line.replace(ANSI_RE, "");
}

// ─── Component ────────────────────────────────────────────────────────────
class ChatInput extends CustomEditor {
	private border: (s: string) => string;
	private accent: (s: string) => string;
	private bashBorder: (s: string) => string;
	private bashAccent: (s: string) => string;
	private companionColor: (s: string) => string;
	private animator = new CompanionAnimator();
	private companionTimer: ReturnType<typeof setInterval> | null = null;
	private companionVisible = false;
	private disposed = false;

	constructor(
		tui: TUI,
		theme: EditorTheme,
		keybindings: KeybindingsManager,
		colorFn: (s: string) => string,
		accentFn: (s: string) => string,
		bashColorFn: (s: string) => string,
		bashAccentFn: (s: string) => string,
		companionColor: (s: string) => string,
		isCurrentEditor: () => boolean,
	) {
		super(tui, theme, keybindings, { paddingX: 0 });
		this.border = colorFn;
		this.accent = accentFn;
		this.bashBorder = bashColorFn;
		this.bashAccent = bashAccentFn;
		this.companionColor = companionColor;

		if (CONFIG.COMPANION_ENABLED) {
			this.companionTimer = setInterval(() => {
				if (this.disposed) return;
				// Pi does not dispose editors replaced by another extension/default.
				if (!isCurrentEditor()) {
					this.dispose();
					return;
				}
				const before = this.animator.getState();
				this.animator.tick(Date.now());
				const after = this.animator.getState();
				const changed = before.lines.join("\n") !== after.lines.join("\n") ||
					(after.lines.length > 0 && before.extraPad !== after.extraPad);
				if (this.companionVisible && changed) this.tui.requestRender();
			}, 100);
		}
	}

	/** Release resources when this editor is replaced or its session shuts down. */
	dispose(): void {
		this.disposed = true;
		this.companionVisible = false;
		if (this.companionTimer !== null) {
			clearInterval(this.companionTimer);
			this.companionTimer = null;
		}
	}

	private isBashMode(): boolean {
		const text = (this as any).getText?.();
		return typeof text === "string" && text.trimStart().startsWith("!");
	}

	render(width: number): string[] {
		this.companionVisible = !this.disposed && CONFIG.COMPANION_ENABLED && width >= MIN_WIDTH_FOR_COMPANION;
		const padMultiplier = CONFIG.BOXED_VIEW ? 3 : 1;
		if (width < 5 + CONFIG.BOX_PAD_X * padMultiplier) return super.render(width);

		const contentWidth = CONFIG.BOXED_VIEW
			? width - 3 - CONFIG.BOX_PAD_X * 3
			: width - 2 * CONFIG.BOX_PAD_X - 1;
		const stock = super.render(contentWidth);
		if (stock.length < 2) return super.render(width);

		const isBash = this.isBashMode();
		const border = isBash ? this.bashBorder : this.border;
		const accent = isBash ? this.bashAccent : this.accent;
		const prefix = CONFIG.PREFIX;

		if (CONFIG.BOXED_VIEW) {
			return this.renderBoxed(stock, contentWidth, width, border, accent, prefix);
		}
		return this.renderUnboxed(stock, contentWidth, width, border, accent, prefix);
	}

	private buildCompanionLines(width: number): string[] {
		if (!CONFIG.COMPANION_ENABLED || width < MIN_WIDTH_FOR_COMPANION) return [];

		const state = this.animator.getState();
		const artWidth = Math.max(...state.lines.map(l => visibleWidth(l)), 0);
		const rawPad = width - COMPANION_PADDING - artWidth + state.extraPad;
		// Clamp: never negative, never exceed terminal width
		const pad = Math.max(0, Math.min(rawPad, width - artWidth));
		const spaces = " ".repeat(pad);

		const lines: string[] = [];
		for (const line of state.lines) {
			lines.push(spaces + this.companionColor(line));
		}
		const topPadding = CONFIG.COMPANION_ENABLED ? CONFIG.COMPANION_TOP_PADDING : 0;
		// Reserve topPadding lines so chat bar doesn't jump — art anchored to bottom
		while (lines.length < topPadding) {
			lines.unshift("");
		}
		return lines;
	}

	private renderBoxed(
		stock: string[],
		contentWidth: number,
		width: number,
		border: (s: string) => string,
		accent: (s: string) => string,
		prefix: string,
	): string[] {
		const innerWidth = width - 2;

		// Solid border: after stripping ANSI every char is "─"
		const isSolidBorder = (line: string) => plainText(line).replace(/─/g, "").length === 0;

		// Scroll indicator: starts with "─" and contains ↑/↓ N more
		const getScrollText = (line: string): string | null => {
			const plain = plainText(line);
			if (!plain.startsWith("─")) return null;
			const m = plain.match(/((?:↑|↓)\s*\d+\s*more)/);
			return m ? m[1] : null;
		};

		const isBorderLike = (line: string) => isSolidBorder(line) || getScrollText(line) !== null;

		const firstIdx = stock.findIndex(isBorderLike);
		let lastIdx = -1;
		for (let i = stock.length - 1; i >= 0; i--) {
			if (isBorderLike(stock[i]!)) {
				lastIdx = i;
				break;
			}
		}

		// Build top/bottom box borders, embedding scroll indicator text when present
		const buildTop = (scrollText: string | null): string => {
			if (!scrollText) return border("┌") + border("─".repeat(innerWidth)) + border("┐");
			const mid = `── ${scrollText} `;
			const remaining = Math.max(0, innerWidth - visibleWidth(mid));
			return border("┌") + border(mid) + border("─".repeat(remaining)) + border("┐");
		};

		const buildBottom = (scrollText: string | null): string => {
			if (!scrollText) return border("└") + border("─".repeat(innerWidth)) + border("┘");
			const mid = `── ${scrollText} `;
			const remaining = Math.max(0, innerWidth - visibleWidth(mid));
			return border("└") + border(mid) + border("─".repeat(remaining)) + border("┘");
		};

		const topScrollText = firstIdx !== -1 ? getScrollText(stock[firstIdx]!) : null;
		const bottomScrollText = lastIdx !== -1 && lastIdx !== firstIdx ? getScrollText(stock[lastIdx]!) : null;

		const top = buildTop(topScrollText);
		const bottom = buildBottom(bottomScrollText);

		// ── companion art ──
		const companionLines = this.buildCompanionLines(width);

		const leftPad = " ".repeat(CONFIG.BOX_PAD_X);
		const rightPad = leftPad;

		// ── body lines (between first and last border/indicator) ──
		const body: string[] = [];
		let isFirstBodyLine = true;
		for (let i = 0; i < stock.length; i++) {
			if (i === firstIdx || i === lastIdx) continue;
			if (lastIdx !== -1 && i > lastIdx) continue;

			const vw = visibleWidth(stock[i]!);
			const pad = vw < contentWidth ? " ".repeat(contentWidth - vw) : "";
			const prefixStr = isFirstBodyLine ? accent(prefix) : " ";
			body.push(border("│") + leftPad + prefixStr + leftPad + stock[i]! + pad + rightPad + border("│"));
			isFirstBodyLine = false;
		}

		// ── menu lines (after last border/indicator) ──
		const menu: string[] = [];
		if (lastIdx !== -1) {
			for (let i = lastIdx + 1; i < stock.length; i++) {
				const vw = visibleWidth(stock[i]!);
				const indent = " ".repeat(CONFIG.EXTRA_MENU_INDENT);
				const pad = vw + CONFIG.EXTRA_MENU_INDENT < width ? " ".repeat(width - vw - CONFIG.EXTRA_MENU_INDENT) : "";
				menu.push(indent + stock[i]! + pad);
			}
		}

		const gap = Array.from({ length: CONFIG.MENU_GAP }, () => "");
		return [...companionLines, top, ...body, bottom, ...gap, ...menu];
	}

	private renderUnboxed(
		stock: string[],
		contentWidth: number,
		width: number,
		border: (s: string) => string,
		accent: (s: string) => string,
		prefix: string,
	): string[] {
		// Solid border: after stripping ANSI every char is "─"
		const isSolidBorder = (line: string) => plainText(line).replace(/─/g, "").length === 0;

		// Scroll indicator: starts with "─" and contains ↑/↓ N more
		const getScrollText = (line: string): string | null => {
			const plain = plainText(line);
			if (!plain.startsWith("─")) return null;
			const m = plain.match(/((?:↑|↓)\s*\d+\s*more)/);
			return m ? m[1] : null;
		};

		const isBorderLike = (line: string) => isSolidBorder(line) || getScrollText(line) !== null;

		const firstIdx = stock.findIndex(isBorderLike);
		let lastIdx = -1;
		for (let i = stock.length - 1; i >= 0; i--) {
			if (isBorderLike(stock[i]!)) {
				lastIdx = i;
				break;
			}
		}

		// Build top/bottom horizontal borders only (no corners, no sides)
		const buildTop = (scrollText: string | null): string => {
			if (!scrollText) return border("─".repeat(width));
			const mid = `── ${scrollText} `;
			const remaining = Math.max(0, width - visibleWidth(mid));
			return border(mid) + border("─".repeat(remaining));
		};

		const buildBottom = (scrollText: string | null): string => {
			if (!scrollText) return border("─".repeat(width));
			const mid = `── ${scrollText} `;
			const remaining = Math.max(0, width - visibleWidth(mid));
			return border(mid) + border("─".repeat(remaining));
		};

		const topScrollText = firstIdx !== -1 ? getScrollText(stock[firstIdx]!) : null;
		const bottomScrollText = lastIdx !== -1 && lastIdx !== firstIdx ? getScrollText(stock[lastIdx]!) : null;

		const top = buildTop(topScrollText);
		const bottom = buildBottom(bottomScrollText);

		// ── companion art ──
		const companionLines = this.buildCompanionLines(width);

		const leftPad = " ".repeat(CONFIG.BOX_PAD_X);

		// ── body lines ──
		const body: string[] = [];
		let isFirstBodyLine = true;
		for (let i = 0; i < stock.length; i++) {
			if (i === firstIdx || i === lastIdx) continue;
			if (lastIdx !== -1 && i > lastIdx) continue;

			const vw = visibleWidth(stock[i]!);
			const pad = vw < contentWidth ? " ".repeat(contentWidth - vw) : "";
			const prefixStr = isFirstBodyLine ? accent(prefix) : " ";
			body.push(leftPad + prefixStr + leftPad + stock[i]! + pad);
			isFirstBodyLine = false;
		}

		// ── menu lines ──
		const menu: string[] = [];
		if (lastIdx !== -1) {
			for (let i = lastIdx + 1; i < stock.length; i++) {
				const vw = visibleWidth(stock[i]!);
				const indent = " ".repeat(CONFIG.EXTRA_MENU_INDENT);
				const pad = vw + CONFIG.EXTRA_MENU_INDENT < width ? " ".repeat(width - vw - CONFIG.EXTRA_MENU_INDENT) : "";
				menu.push(indent + stock[i]! + pad);
			}
		}

		const gap = Array.from({ length: CONFIG.MENU_GAP }, () => "");
		return [...companionLines, top, ...body, bottom, ...gap, ...menu];
	}
}

// ─── Extension entry ──────────────────────────────────────────────────────
export default function (pi: ExtensionAPI) {
	let editor: ChatInput | undefined;
	const disposeEditor = () => {
		editor?.dispose();
		editor = undefined;
	};
	pi.on("session_shutdown", disposeEditor);
	pi.on("session_start", async (_event, ctx) => {
		disposeEditor();
		const factory = (tui: TUI, theme: EditorTheme, kb: KeybindingsManager) => {
			disposeEditor();
			const colorFn = (s: string) => applyColor(ctx.ui.theme, CONFIG.BORDER_COLOR, s);
			const accentFn = (s: string) => applyColor(ctx.ui.theme, CONFIG.PREFIX_COLOR, s);
			const bashColorFn = (s: string) => applyColor(ctx.ui.theme, "bashMode", s);
			const bashAccentFn = (s: string) => applyColor(ctx.ui.theme, "bashMode", s);
			const companionColorFn = (s: string) => applyColor(ctx.ui.theme, CONFIG.COMPANION_COLOR, s);
			editor = new ChatInput(tui, theme, kb, colorFn, accentFn, bashColorFn, bashAccentFn, companionColorFn,
				() => typeof ctx.ui.getEditorComponent !== "function" || ctx.ui.getEditorComponent() === factory);
			return editor;
		};
		ctx.ui.setEditorComponent(factory);
	});
}