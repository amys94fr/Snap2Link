import { openUrl } from "@tauri-apps/plugin-opener";
import { t } from "@/i18n";
import logoUrl from "@/assets/logo.png";
import {
  APP_NAME,
  APP_VERSION,
  APP_AUTHOR,
  APP_GITHUB,
  APP_LICENSE,
  APP_LICENSE_TEXT,
} from "@/version";
import { Card, Row, Section } from "./settings/ui";

export function AboutWindow() {
  return (
    <Section>
      <div className="flex items-center gap-4">
        <img
          src={logoUrl}
          alt=""
          aria-hidden="true"
          className="size-16 select-none drop-shadow-md"
          draggable={false}
        />
        <div>
          <h2 className="text-lg font-bold">{APP_NAME}</h2>
          <p className="text-[13px] text-slate-300">
            {t("about.version", { version: APP_VERSION })}
          </p>
        </div>
      </div>

      <p className="text-slate-300">{t("about.description")}</p>

      <Card>
        <Row label={t("about.author")}>
          <span data-testid="author">{APP_AUTHOR}</span>
        </Row>
        <Row label={t("about.github")}>
          <button
            type="button"
            dir="ltr"
            onClick={() => void openUrl(APP_GITHUB)}
            className="min-h-11 text-blue-300 hover:underline cursor-pointer"
          >
            {APP_GITHUB.replace(/^https?:\/\/github\.com\//, "")}
          </button>
        </Row>
        <Row label={t("about.license")}>
          <span>{APP_LICENSE}</span>
        </Row>
      </Card>

      <pre
        dir="ltr"
        className="max-h-40 overflow-y-auto p-3 text-[11px] font-mono leading-relaxed text-slate-300 whitespace-pre-wrap bg-slate-900 border border-slate-800 rounded-[10px]"
      >
        {APP_LICENSE_TEXT}
      </pre>
    </Section>
  );
}
