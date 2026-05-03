import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { enable } from "@tauri-apps/plugin-autostart";
import { t } from "@/i18n";
import { APP_NAME } from "@/version";
import logoUrl from "@/assets/logo.png";

type Step = "welcome" | "connect" | "success";

interface Props {
  onComplete: () => void;
}

export function SetupWizard({ onComplete }: Props) {
  const [step, setStep] = useState<Step>("welcome");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");

  const handleConnect = async () => {
    setLoading(true);
    setError(null);
    try {
      const mail = await invoke<string>("authenticate");
      setEmail(mail);
      setStep("success");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleFinish = async () => {
    try {
      await enable();
    } catch {
      // Autostart may fail in dev; non-fatal.
    }
    onComplete();
  };

  return (
    <div className="flex flex-col items-center justify-center h-screen text-slate-100 px-8 text-center">
      {step === "welcome" && (
        <>
          <img
            src={logoUrl}
            alt=""
            aria-hidden="true"
            className="w-24 h-24 mb-4 select-none drop-shadow-lg"
            draggable={false}
          />
          <h1 className="text-3xl font-bold mb-2">{APP_NAME}</h1>
          <p className="text-sm text-slate-400 whitespace-pre-line mb-10 leading-relaxed">
            {t("wizard.welcome.subtitle")}
          </p>
          <button
            type="button"
            onClick={() => setStep("connect")}
            className="btn-primary"
          >
            {t("wizard.welcome.btn")}
          </button>
        </>
      )}

      {step === "connect" && (
        <>
          <h2 className="text-2xl font-bold mb-3">
            {t("wizard.connect.title")}
          </h2>
          <p className="text-sm text-slate-400 whitespace-pre-line mb-8 leading-relaxed">
            {t("wizard.connect.body")}
          </p>
          <button
            type="button"
            onClick={handleConnect}
            disabled={loading}
            className="btn-primary w-72"
          >
            {loading
              ? t("wizard.connect.loading")
              : error
                ? t("wizard.connect.retry")
                : t("wizard.connect.btn")}
          </button>
          {loading && (
            <p className="text-xs text-slate-400 mt-4">
              {t("wizard.connect.browser_hint")}
            </p>
          )}
          {error && (
            <p className="text-xs text-danger mt-4 max-w-xs break-words">
              {t("wizard.connect.error", { msg: error.slice(0, 80) })}
            </p>
          )}
        </>
      )}

      {step === "success" && (
        <>
          <span className="text-6xl mb-4" aria-hidden="true">
            ✅
          </span>
          <h2 className="text-2xl font-bold text-success mb-2">
            {t("wizard.success.connected")}
          </h2>
          <p className="text-sm text-slate-400 mb-2">{email}</p>
          <p className="text-sm whitespace-pre-line mb-8 leading-relaxed">
            {t("wizard.success.ready")}
          </p>
          <button
            type="button"
            onClick={handleFinish}
            className="btn-success"
          >
            {t("wizard.success.btn")}
          </button>
        </>
      )}
    </div>
  );
}
