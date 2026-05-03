import { open } from "@tauri-apps/plugin-shell";
import { t } from "@/i18n";
import logoUrl from "@/assets/logo.png";
import {
  APP_NAME,
  APP_VERSION,
  APP_AUTHOR,
  APP_GITHUB,
  APP_DESCRIPTION,
  APP_LICENSE,
  APP_LICENSE_TEXT,
} from "@/version";

interface Props {
  onClose: () => void;
}

export function AboutWindow({ onClose }: Props) {
  const handleGithub = () => {
    void open(APP_GITHUB);
  };

  return (
    <div className="bg-slate-950 text-slate-100 h-screen overflow-y-auto px-8 py-7 flex flex-col">
      <div className="flex flex-col items-center text-center mb-4">
        <img
          src={logoUrl}
          alt=""
          aria-hidden="true"
          className="w-16 h-16 mb-2 select-none drop-shadow-md"
          draggable={false}
        />
        <h1 className="text-2xl font-bold">{APP_NAME}</h1>
        <p className="text-xs text-slate-400 mt-1">
          {t("about.version", { version: APP_VERSION })}
        </p>
      </div>

      <hr className="border-slate-800 mb-4" />

      <p className="text-sm text-slate-400 text-center mb-4 leading-relaxed">
        {APP_DESCRIPTION}
      </p>

      <hr className="border-slate-800 mb-4" />

      <dl className="text-sm space-y-2 mb-4">
        <div className="flex">
          <dt className="w-20 text-slate-400 text-xs">{t("about.author")}</dt>
          <dd data-testid="author">{APP_AUTHOR}</dd>
        </div>
        <div className="flex items-center">
          <dt className="w-20 text-slate-400 text-xs">{t("about.github")}</dt>
          <dd>
            <button
              type="button"
              onClick={handleGithub}
              className="text-brand hover:underline cursor-pointer"
            >
              {APP_GITHUB.replace(/^https?:\/\/github\.com\//, "")}
            </button>
          </dd>
        </div>
        <div className="flex">
          <dt className="w-20 text-slate-400 text-xs">{t("about.license")}</dt>
          <dd>{APP_LICENSE}</dd>
        </div>
      </dl>

      <hr className="border-slate-800 mb-2" />

      <pre className="flex-1 min-h-[110px] max-h-[160px] overflow-y-auto text-[10px] font-mono leading-relaxed text-slate-400 whitespace-pre-wrap mb-4">
        {APP_LICENSE_TEXT}
      </pre>

      <div className="flex justify-center mt-auto">
        <button
          type="button"
          onClick={onClose}
          className="btn bg-brand hover:bg-brand-dark text-white px-8 py-2 text-sm rounded-lg"
        >
          {t("about.close")}
        </button>
      </div>
    </div>
  );
}
