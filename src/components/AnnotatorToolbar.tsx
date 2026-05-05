import { type ReactNode } from "react";
import { t } from "@/i18n";
import {
  useAnnotatorStore,
  DEFAULT_COLORS,
  type AnnotatorTool,
  type AnnotatorStrokeWidth,
} from "@/store/annotatorStore";

interface ToolDef {
  id: AnnotatorTool;
  labelKey: string;
  shortcut: string;
  icon: ReactNode;
}

/** Tiny inline SVGs — keep the bundle clean (no icon library) and the
 *  toolbar perfectly themable via Tailwind text colour. */
const ICON_PROPS = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const TOOLS: ToolDef[] = [
  {
    id: "select",
    labelKey: "annotator.tool.select",
    shortcut: "V",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="m4 4 7 16 2-7 7-2z" />
      </svg>
    ),
  },
  {
    id: "pen",
    labelKey: "annotator.tool.pen",
    shortcut: "P",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4z" />
      </svg>
    ),
  },
  {
    id: "rectangle",
    labelKey: "annotator.tool.rectangle",
    shortcut: "R",
    icon: (
      <svg {...ICON_PROPS}>
        <rect x="3" y="5" width="18" height="14" rx="1" />
      </svg>
    ),
  },
  {
    id: "circle",
    labelKey: "annotator.tool.circle",
    shortcut: "O",
    icon: (
      <svg {...ICON_PROPS}>
        <ellipse cx="12" cy="12" rx="9" ry="7" />
      </svg>
    ),
  },
  {
    id: "arrow",
    labelKey: "annotator.tool.arrow",
    shortcut: "A",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M5 12h14" />
        <path d="m13 5 7 7-7 7" />
      </svg>
    ),
  },
  {
    id: "text",
    labelKey: "annotator.tool.text",
    shortcut: "T",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M4 7V4h16v3" />
        <path d="M9 20h6" />
        <path d="M12 4v16" />
      </svg>
    ),
  },
  {
    id: "blur",
    labelKey: "annotator.tool.blur",
    shortcut: "B",
    // Water-drop silhouette — the universal "blur / soften" icon in
    // image editors (Photoshop's blur tool uses the same metaphor).
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M12 2.5c-3.5 4.7-7 8.5-7 12.5a7 7 0 0 0 14 0c0-4-3.5-7.8-7-12.5z" />
      </svg>
    ),
  },
];

const STROKE_WIDTHS: AnnotatorStrokeWidth[] = [2, 4, 8];

export function AnnotatorToolbar() {
  const tool = useAnnotatorStore((s) => s.tool);
  const setTool = useAnnotatorStore((s) => s.setTool);
  const color = useAnnotatorStore((s) => s.color);
  const setColor = useAnnotatorStore((s) => s.setColor);
  const strokeWidth = useAnnotatorStore((s) => s.strokeWidth);
  const setStrokeWidth = useAnnotatorStore((s) => s.setStrokeWidth);

  return (
    <aside
      data-testid="annotator-toolbar"
      className="w-14 shrink-0 border-r border-slate-800 bg-slate-900/60 flex flex-col items-center py-3 gap-1"
    >
      {/* Tool buttons */}
      {TOOLS.map((tdef) => {
        const active = tool === tdef.id;
        return (
          <button
            key={tdef.id}
            type="button"
            data-testid={`tool-${tdef.id}`}
            data-active={active}
            aria-label={`${t(tdef.labelKey)} (${tdef.shortcut})`}
            title={`${t(tdef.labelKey)} (${tdef.shortcut})`}
            onClick={() => setTool(tdef.id)}
            className={
              "w-9 h-9 rounded-md flex items-center justify-center transition " +
              (active
                ? "bg-brand text-white"
                : "text-slate-300 hover:bg-slate-800 hover:text-white")
            }
          >
            {tdef.icon}
          </button>
        );
      })}

      {/* Divider */}
      <div className="w-7 h-px my-2 bg-slate-700" />

      {/* Colour swatches */}
      <div className="grid grid-cols-2 gap-1" data-testid="annotator-colors">
        {DEFAULT_COLORS.map((c) => {
          const active = color.toUpperCase() === c.toUpperCase();
          return (
            <button
              key={c}
              type="button"
              data-testid={`color-${c.toLowerCase()}`}
              data-active={active}
              aria-label={`${t("annotator.color")}: ${c}`}
              onClick={() => setColor(c)}
              className={
                "w-4 h-4 rounded-full ring-offset-2 ring-offset-slate-900 transition " +
                (active ? "ring-2 ring-white" : "ring-1 ring-slate-700")
              }
              style={{ backgroundColor: c }}
            />
          );
        })}
      </div>

      {/* Custom colour picker (native HTML5) */}
      <label
        className="mt-1 w-9 h-7 rounded-md border border-slate-700 cursor-pointer overflow-hidden"
        title={t("annotator.color")}
      >
        <input
          type="color"
          data-testid="annotator-color-custom"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="w-full h-full p-0 border-0 cursor-pointer bg-transparent"
        />
      </label>

      {/* Divider */}
      <div className="w-7 h-px my-2 bg-slate-700" />

      {/* Stroke width — three dots of growing size */}
      <div className="flex flex-col items-center gap-1" data-testid="annotator-strokes">
        {STROKE_WIDTHS.map((w) => {
          const active = strokeWidth === w;
          const dotPx = w + 4; // 6 / 8 / 12
          return (
            <button
              key={w}
              type="button"
              data-testid={`stroke-${w}`}
              data-active={active}
              aria-label={`${t("annotator.stroke")}: ${w}px`}
              onClick={() => setStrokeWidth(w)}
              className={
                "w-7 h-7 rounded-md flex items-center justify-center transition " +
                (active ? "bg-slate-700" : "hover:bg-slate-800")
              }
            >
              <span
                className="rounded-full bg-current"
                style={{ width: dotPx, height: dotPx, color }}
              />
            </button>
          );
        })}
      </div>
    </aside>
  );
}
