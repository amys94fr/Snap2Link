import { t } from "@/i18n";
import clsx from "clsx";

export type UploaderState = "uploading" | "success";

interface Props {
  state: UploaderState;
}

/**
 * Centered status toast shown over the overlay window while a screenshot
 * is being uploaded. The component centers itself in its parent (which
 * the OverlayWindow makes fill the screen).
 */
export function UploaderToast({ state }: Props) {
  const isSuccess = state === "success";
  const title = isSuccess
    ? t("uploader.success.title")
    : t("uploader.title");
  const subtitle = isSuccess
    ? t("uploader.success.subtitle")
    : t("uploader.subtitle");

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 flex items-center justify-center pointer-events-none"
    >
      <div
        className={clsx(
          "flex items-center gap-3 min-w-[360px] max-w-[420px] bg-slate-900/95 border rounded-xl shadow-2xl px-5 py-4 backdrop-blur transition-colors",
          isSuccess ? "border-success/50" : "border-slate-800",
        )}
      >
        {isSuccess ? <SuccessCheck /> : <Spinner />}
        <div className="flex-1 min-w-0">
          <p
            className={clsx(
              "text-sm font-semibold truncate",
              isSuccess ? "text-success" : "text-slate-100",
            )}
          >
            {title}
          </p>
          <p className="text-[11px] text-slate-400 truncate">{subtitle}</p>
        </div>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <span
      data-testid="uploader-spinner"
      aria-hidden="true"
      className="relative inline-block h-7 w-7 shrink-0"
    >
      <span className="absolute inset-0 rounded-full border-2 border-slate-700" />
      <span className="absolute inset-0 rounded-full border-2 border-transparent border-t-brand animate-spin" />
    </span>
  );
}

function SuccessCheck() {
  return (
    <span
      data-testid="uploader-check"
      aria-hidden="true"
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-success/20"
    >
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4 text-success"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </span>
  );
}
