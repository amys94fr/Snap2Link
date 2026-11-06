import type { ReactNode } from "react";
import clsx from "clsx";

export const BUTTON =
  "btn min-h-11 px-3.5 text-[13px] bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-50 whitespace-nowrap";
export const BUTTON_PRIMARY =
  "btn min-h-11 px-3.5 text-[13px] bg-brand hover:bg-brand-dark text-white whitespace-nowrap";
export const BUTTON_DANGER =
  "btn min-h-11 px-3.5 text-[13px] border border-red-300 text-red-300 hover:bg-red-300/10 whitespace-nowrap";
export const KEY =
  "px-2.5 py-1 bg-slate-950 border border-slate-600 rounded-md font-mono text-[13px] text-slate-50";

export function Section({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2.5">
      {title && (
        <h2 className="text-[13px] font-semibold text-slate-300">{title}</h2>
      )}
      {children}
    </section>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-[10px] divide-y divide-slate-800">
      {children}
    </div>
  );
}

/** One setting: what it is and its consequence on one side, the control on
 *  the other. */
export function Row({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  htmlFor?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2.5 px-4 py-3">
      <div className="flex-[1_1_220px] min-w-0">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-sm font-semibold">
            {label}
          </label>
        ) : (
          <div className="text-sm font-semibold break-words">{label}</div>
        )}
        {hint && <p className="mt-0.5 text-[13px] text-slate-300">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="min-w-11 min-h-11 flex items-center justify-center rounded-lg cursor-pointer"
    >
      <span
        className={clsx(
          "relative block w-[42px] h-6 rounded-full border transition-colors",
          checked
            ? "bg-brand border-blue-300"
            : "bg-slate-950 border-slate-400",
        )}
      >
        <span
          className="absolute top-0.5 size-[18px] rounded-full bg-white transition-[inset-inline-start] motion-reduce:transition-none"
          style={{ insetInlineStart: checked ? 20 : 2 }}
        />
      </span>
    </button>
  );
}

export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: ReadonlyArray<{ id: T; label: string }>;
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const active = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.id)}
            className={clsx(
              "btn min-h-11 px-3 text-[13px] border",
              active
                ? "bg-brand border-blue-300 text-white"
                : "bg-slate-950 border-slate-600 text-slate-200 hover:border-slate-400",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

const ICON_PROPS = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

export function CameraIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
      <circle cx="12" cy="13" r="3" />
    </svg>
  );
}

export function ClockIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15.5 14" />
    </svg>
  );
}

export function CloudIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9z" />
    </svg>
  );
}

export function SlidersIcon() {
  return (
    <svg {...ICON_PROPS}>
      <line x1="4" y1="21" x2="4" y2="14" />
      <line x1="4" y1="10" x2="4" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12" y2="3" />
      <line x1="20" y1="21" x2="20" y2="16" />
      <line x1="20" y1="12" x2="20" y2="3" />
      <line x1="1" y1="14" x2="7" y2="14" />
      <line x1="9" y1="8" x2="15" y2="8" />
      <line x1="17" y1="16" x2="23" y2="16" />
    </svg>
  );
}

export function InfoIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

export function WarningIcon({ size = 18 }: { size?: number }) {
  return (
    <svg {...ICON_PROPS} width={size} height={size} className="shrink-0">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

/** Google's mark keeps its own colors, on any background. */
export function GoogleIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 48 48" aria-hidden className="shrink-0">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg {...ICON_PROPS} width={14} height={14} strokeWidth={2.5}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      {...ICON_PROPS}
      width={16}
      height={16}
      className={clsx("shrink-0 text-slate-300", open && "rotate-180")}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export function PlusIcon() {
  return (
    <svg {...ICON_PROPS} width={16} height={16}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
