import { t } from "@/i18n";
import clsx from "clsx";

export type UploaderState =
  | "uploading"
  | "copied"
  | "deleting"
  | "deleted"
  | "delete_failed";

interface Props {
  state: UploaderState;
  onDelete?: () => void;
}

const TEXT: Record<UploaderState, { title: string; subtitle: string }> = {
  uploading: { title: "uploader.title", subtitle: "uploader.subtitle" },
  copied: {
    title: "uploader.success.title",
    subtitle: "uploader.success.subtitle",
  },
  deleting: {
    title: "uploader.success.title",
    subtitle: "uploader.success.subtitle",
  },
  deleted: {
    title: "uploader.deleted.title",
    subtitle: "uploader.deleted.subtitle",
  },
  delete_failed: {
    title: "uploader.delete_failed.title",
    subtitle: "uploader.delete_failed.subtitle",
  },
};

/** Content of the toast window: progress, then the result of the share. */
export function UploaderToast({ state, onDelete }: Props) {
  const isSuccess = state === "copied" || state === "deleting";
  const failed = state === "delete_failed";
  const canDelete = isSuccess || failed;
  const { title, subtitle } = TEXT[state];

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 flex items-center justify-center"
    >
      <div
        className={clsx(
          "flex items-center gap-3 w-full h-full px-4 bg-slate-950 border rounded-xl",
          isSuccess && "border-green-500/60",
          failed && "border-red-300/60",
          !isSuccess && !failed && "border-slate-700",
        )}
      >
        {state === "uploading" ? <Spinner /> : <SuccessCheck failed={failed} />}
        <div className="flex-1 min-w-0">
          <p
            className={clsx(
              "text-sm font-semibold truncate",
              isSuccess && "text-green-300",
              failed && "text-red-300",
              !isSuccess && !failed && "text-slate-100",
            )}
          >
            {t(title)}
          </p>
          <p className="text-xs text-slate-300 line-clamp-2">{t(subtitle)}</p>
        </div>
        {canDelete && (
          <button
            type="button"
            data-testid="toast-delete"
            onClick={onDelete}
            disabled={state === "deleting"}
            className="btn shrink-0 min-h-11 px-3 text-[13px] border border-red-300 text-red-300 hover:bg-red-300/10"
          >
            {state === "deleting" ? t("uploader.deleting") : t("uploader.delete")}
          </button>
        )}
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
      <span className="absolute inset-0 rounded-full border-2 border-transparent border-t-blue-300 animate-spin motion-reduce:animate-none" />
    </span>
  );
}

function SuccessCheck({ failed }: { failed: boolean }) {
  return (
    <span
      data-testid="uploader-check"
      aria-hidden="true"
      className={clsx(
        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
        failed ? "bg-red-300/20 text-red-300" : "bg-green-500/20 text-green-300",
      )}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {failed ? (
          <>
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </>
        ) : (
          <polyline points="20 6 9 17 4 12" />
        )}
      </svg>
    </span>
  );
}
