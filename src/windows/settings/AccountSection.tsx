import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { t } from "@/i18n";
import {
  BUTTON,
  BUTTON_DANGER,
  BUTTON_PRIMARY,
  Card,
  Row,
  Section,
} from "./ui";

interface AccountStatus {
  email: string;
  plan: string;
  captures_today: number;
  daily_captures: number;
  slots_used: number;
  slots: number;
}

type View =
  | { name: "loading" }
  | { name: "unavailable" }
  | { name: "signed_out" }
  | { name: "code"; email: string }
  | { name: "signed_in"; account: AccountStatus };

const CODE_LENGTH = 6;
/** A code can take a moment to arrive, and an address only gets 5 a day. */
const RESEND_DELAY_S = 30;

const INPUT =
  "min-h-11 px-3 bg-slate-950 border border-slate-600 rounded-lg text-sm text-slate-50";

/** Refusals Rust reports as codes, with what to show for each. */
const ERRORS: Record<string, string> = {
  relay_invalid_email: "account.error.invalid_email",
  relay_invalid_code: "account.error.invalid_code",
  relay_daily_limit: "account.error.too_many_codes",
  relay_service_busy: "account.error.busy",
  relay_mail_unavailable: "account.error.mail",
  relay_account_banned: "account.error.banned",
  relay_guest_banned: "uploader.error.banned",
  relay_unreachable: "uploader.error.unreachable",
  relay_guest_required: "uploader.error.verification_failed",
  relay_verification_failed: "uploader.error.verification_failed",
  relay_guest_cancelled: "uploader.error.verification_cancelled",
  relay_session_required: "account.load_failed",
};

function errorText(error: unknown): string {
  const code = error instanceof Error ? error.message : String(error);
  const key = ERRORS[code];
  return key ? t(key) : code.slice(0, 120);
}

function FormError({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p role="alert" className="px-4 pb-3 text-[13px] text-red-300">
      {text}
    </p>
  );
}

function SignedOut({ onSent }: { onSent: (email: string) => void }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const address = email.trim();
    if (!address.includes("@")) {
      setError(t("account.error.invalid_email"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await invoke("request_login_code", { email: address });
      onSent(address);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <Card>
      <Row
        label={t("settings.host.no_account")}
        hint={t("settings.hosting.plan_hint")}
      />
      <form onSubmit={(e) => void send(e)} noValidate>
        <Row
          label={t("account.free_title")}
          hint={t("account.free_hint")}
          htmlFor="account-email"
        >
          <div className="flex flex-wrap gap-2">
            <input
              id="account-email"
              type="email"
              dir="ltr"
              autoComplete="email"
              placeholder={t("account.email_label")}
              aria-label={t("account.email_label")}
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
              }}
              className={`${INPUT} w-56`}
            />
            <button type="submit" disabled={busy} className={BUTTON_PRIMARY}>
              {busy ? t("account.sending") : t("account.send_code")}
            </button>
          </div>
        </Row>
        <FormError text={error} />
      </form>
    </Card>
  );
}

function CodeStep({
  email,
  onBack,
  onSignedIn,
}: {
  email: string;
  onBack: () => void;
  onSignedIn: () => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(RESEND_DELAY_S);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  useEffect(() => {
    if (wait === 0) return;
    const id = window.setTimeout(() => setWait((s) => s - 1), 1000);
    return () => window.clearTimeout(id);
  }, [wait]);

  const verify = async (value: string) => {
    setBusy(true);
    setError(null);
    try {
      await invoke("verify_login_code", { email, code: value });
      onSignedIn();
    } catch (e) {
      setError(errorText(e));
      setCode("");
      setBusy(false);
      input.current?.focus();
    }
  };

  const type = (text: string) => {
    const digits = text.replace(/\D/g, "").slice(0, CODE_LENGTH);
    setCode(digits);
    setError(null);
    // Speed is the point of this app: a pasted code needs no extra click.
    if (digits.length === CODE_LENGTH && !busy) void verify(digits);
  };

  const resend = async () => {
    setError(null);
    setWait(RESEND_DELAY_S);
    try {
      await invoke("request_login_code", { email });
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <Card>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (code.length === CODE_LENGTH) void verify(code);
        }}
      >
        <Row
          label={t("account.code_label")}
          hint={t("account.code_sent", { email })}
          htmlFor="account-code"
        >
          <div className="flex flex-wrap gap-2">
            <input
              id="account-code"
              ref={input}
              type="text"
              dir="ltr"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={CODE_LENGTH}
              value={code}
              disabled={busy}
              onChange={(e) => type(e.target.value)}
              className={`${INPUT} w-32 text-center font-mono tracking-[0.3em]`}
            />
            <button
              type="submit"
              disabled={busy || code.length < CODE_LENGTH}
              className={BUTTON_PRIMARY}
            >
              {busy ? t("account.verifying") : t("account.verify")}
            </button>
          </div>
        </Row>
        <FormError text={error} />
      </form>
      <div className="flex flex-wrap gap-2 px-4 py-3">
        <button
          type="button"
          onClick={() => void resend()}
          disabled={wait > 0 || busy}
          className={BUTTON}
        >
          {wait > 0
            ? t("account.resend_wait", { seconds: wait })
            : t("account.resend")}
        </button>
        <button type="button" onClick={onBack} disabled={busy} className={BUTTON}>
          {t("account.change_email")}
        </button>
      </div>
    </Card>
  );
}

function SignedIn({
  account,
  onGone,
}: {
  account: AccountStatus;
  onGone: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const leave = async (command: "sign_out" | "delete_account") => {
    setBusy(true);
    setError(null);
    try {
      await invoke(command);
      onGone();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <Card>
      <Row
        label={<span dir="ltr">{account.email}</span>}
        hint={t("account.plan_free")}
      >
        <button
          type="button"
          onClick={() => void leave("sign_out")}
          disabled={busy}
          className={BUTTON}
        >
          {t("account.sign_out")}
        </button>
      </Row>
      <Row label={t("account.captures_today")}>
        <span dir="ltr" className="text-sm font-semibold tabular-nums">
          {account.captures_today} / {account.daily_captures}
        </span>
      </Row>
      <Row
        label={t("account.active_links")}
        hint={t("account.active_links_hint")}
      >
        <span dir="ltr" className="text-sm font-semibold tabular-nums">
          {account.slots_used} / {account.slots}
        </span>
      </Row>
      {confirming ? (
        <Row label={t("account.delete_confirm")}>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy}
              className={BUTTON}
            >
              {t("account.delete_no")}
            </button>
            <button
              type="button"
              onClick={() => void leave("delete_account")}
              disabled={busy}
              className={BUTTON_DANGER}
            >
              {t("account.delete_yes")}
            </button>
          </div>
        </Row>
      ) : (
        <Row label={t("account.delete_title")} hint={t("account.delete_hint")}>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className={BUTTON_DANGER}
          >
            {t("account.delete")}
          </button>
        </Row>
      )}
      <FormError text={error} />
    </Card>
  );
}

/** The plan of Snap2Link hosting: signing in, and what the account has used. */
export function AccountSection({
  onEmail,
}: {
  onEmail: (email: string) => void;
}) {
  const [view, setView] = useState<View>({ name: "loading" });

  const load = useCallback(async () => {
    try {
      const account = await invoke<AccountStatus | null>("get_account");
      setView(
        account ? { name: "signed_in", account } : { name: "signed_out" },
      );
      onEmail(account?.email ?? "");
    } catch {
      setView({ name: "unavailable" });
    }
  }, [onEmail]);

  useEffect(() => {
    void load();
  }, [load]);

  // The counters move while the window is hidden: a capture never opens it.
  useEffect(() => {
    if (view.name !== "signed_in") return;
    const refresh = () => void load();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [view.name, load]);

  return (
    <Section title={t("settings.hosting.plan")}>
      {view.name === "loading" && (
        <div aria-busy="true" className="h-24 rounded-[10px] bg-slate-900" />
      )}
      {view.name === "unavailable" && (
        <Card>
          <Row label={t("account.load_failed")}>
            <button type="button" onClick={() => void load()} className={BUTTON}>
              {t("account.retry")}
            </button>
          </Row>
        </Card>
      )}
      {view.name === "signed_out" && (
        <SignedOut onSent={(email) => setView({ name: "code", email })} />
      )}
      {view.name === "code" && (
        <CodeStep
          email={view.email}
          onBack={() => setView({ name: "signed_out" })}
          onSignedIn={() => void load()}
        />
      )}
      {view.name === "signed_in" && (
        <SignedIn account={view.account} onGone={() => void load()} />
      )}
    </Section>
  );
}
