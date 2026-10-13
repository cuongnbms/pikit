import type { RenderedSegment, SegmentContext } from "../types.js";
import { applyColor } from "../theme.js";
import { color } from "./helpers.js";

export const modelSegment = {
  id: "model" as const,
  render(ctx: SegmentContext): RenderedSegment {
    const opts = ctx.options.model ?? {};
    let modelName = (opts.label === "id" ? ctx.model?.id : ctx.model?.name || ctx.model?.id) || "no-model";

    if (modelName.startsWith("Claude ")) {
      modelName = modelName.slice(7);
    }

    let content = color(ctx, "model", modelName);

    if (ctx.model?.provider && opts.showProvider !== false) {
      content += ` ${applyColor(ctx.theme, "dim", `(${ctx.model.provider})`)}`;
    }

    if (ctx.routedModel) {
      const routed = ctx.routedModel;
      content += ` ${applyColor(ctx.theme, "dim", "→")} ${color(ctx, "model", routed.id)}`;
      content += ` ${applyColor(ctx.theme, "dim", `(${routed.provider})`)}`;
      if (routed.thinkingLevel) {
        content += ` ${applyColor(ctx.theme, "dim", `• ${routed.thinkingLevel}`)}`;
      }
    }

    return { content, visible: true };
  },
};
