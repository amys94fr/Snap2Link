import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ACCOUNT_PAGE, AccountSection } from "./AccountSection";

const ACCOUNT = {
  email: "someone@example.com",
  plan: "free",
  captures_today: 12,
  daily_captures: 20,
  slots_used: 4,
  slots: 6,
};

type Handler = (args?: Record<string, unknown>) => unknown;

function relay(handlers: Record<string, Handler>) {
  vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
    const handler = handlers[cmd];
    return handler ? handler(args as Record<string, unknown>) : undefined;
  });
}

const refuse = (code: string) => () => {
  throw code;
};

async function typeEmail(address = "someone@example.com") {
  await userEvent.type(
    await screen.findByRole("textbox", { name: /email address/i }),
    address,
  );
  await userEvent.click(screen.getByRole("button", { name: /get a code/i }));
}

describe("<AccountSection />", () => {
  const onEmail = vi.fn();

  beforeEach(() => {
    onEmail.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("signed out", () => {
    it("shows the guest limits and what an account adds", async () => {
      relay({ get_account: () => null });
      render(<AccountSection onEmail={onEmail} />);

      expect(await screen.findByText(/5 captures a day/i)).toBeInTheDocument();
      expect(screen.getByText(/20 captures a day and 6 links/i)).toBeInTheDocument();
      expect(onEmail).toHaveBeenCalledWith("");
    });

    it("sends the trimmed address and moves on to the code", async () => {
      relay({ get_account: () => null });
      render(<AccountSection onEmail={onEmail} />);

      await typeEmail("  someone@example.com ");

      expect(invoke).toHaveBeenCalledWith("request_login_code", {
        email: "someone@example.com",
      });
      expect(await screen.findByLabelText(/6-digit code/i)).toHaveFocus();
      expect(screen.getByText(/sent to someone@example.com/i)).toBeInTheDocument();
    });

    it("doesn't ask the relay for something that can't be an address", async () => {
      relay({ get_account: () => null });
      render(<AccountSection onEmail={onEmail} />);

      await typeEmail("nobody");

      expect(await screen.findByRole("alert")).toHaveTextContent(/doesn't look like/i);
      expect(invoke).not.toHaveBeenCalledWith("request_login_code", expect.anything());
    });

    it.each([
      ["relay_invalid_email", /doesn't look like/i],
      ["relay_daily_limit", /too many codes/i],
      ["relay_service_busy", /busy right now/i],
      ["relay_mail_unavailable", /couldn't be sent/i],
      ["relay_unreachable", /can't be reached/i],
      ["relay_guest_cancelled", /check cancelled/i],
    ])("explains %s and lets the user try again", async (code, message) => {
      relay({ get_account: () => null, request_login_code: refuse(code) });
      render(<AccountSection onEmail={onEmail} />);

      await typeEmail();

      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      expect(screen.getByRole("button", { name: /get a code/i })).toBeEnabled();
    });
  });

  describe("Google", () => {
    const button = () => screen.findByRole("button", { name: /continue with google/i });

    it("signs in and shows the account", async () => {
      let signedIn = false;
      relay({
        get_account: () => (signedIn ? ACCOUNT : null),
        sign_in_with_google: () => {
          signedIn = true;
        },
      });
      render(<AccountSection onEmail={onEmail} />);

      await userEvent.click(await button());

      expect(await screen.findByText(ACCOUNT.email)).toBeInTheDocument();
      expect(onEmail).toHaveBeenLastCalledWith(ACCOUNT.email);
    });

    it("says where to finish, and keeps both ways open", async () => {
      relay({ get_account: () => null, sign_in_with_google: () => new Promise(() => {}) });
      render(<AccountSection onEmail={onEmail} />);

      await userEvent.click(await button());

      expect(await screen.findByRole("status")).toHaveTextContent(/in your browser/i);
      expect(await button()).toBeEnabled();
      expect(screen.getByRole("textbox", { name: /email address/i })).toBeEnabled();
    });

    it.each(["google_sign_in_failed", "relay_google_refused"])(
      "explains %s",
      async (code) => {
        relay({ get_account: () => null, sign_in_with_google: refuse(code) });
        render(<AccountSection onEmail={onEmail} />);

        await userEvent.click(await button());

        expect(await screen.findByRole("alert")).toHaveTextContent(/didn't finish/i);
        expect(screen.queryByRole("status")).not.toBeInTheDocument();
      },
    );

    it("ignores an old attempt once a new one started", async () => {
      const finish: Array<(error?: string) => void> = [];
      relay({
        get_account: () => null,
        sign_in_with_google: () =>
          new Promise<void>((resolve, reject) => {
            finish.push((error) => (error ? reject(error) : resolve()));
          }),
      });
      render(<AccountSection onEmail={onEmail} />);

      await userEvent.click(await button());
      await userEvent.click(await button());
      await act(async () => finish[0]("google_sign_in_failed"));

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.getByRole("status")).toBeInTheDocument();
    });
  });

  describe("the code", () => {
    async function atTheCode(handlers: Record<string, Handler> = {}) {
      relay({ get_account: () => null, ...handlers });
      render(<AccountSection onEmail={onEmail} />);
      await typeEmail();
      return screen.findByLabelText(/6-digit code/i);
    }

    it("signs in as soon as the code is complete, and shows the account", async () => {
      let signedIn = false;
      const input = await atTheCode({
        get_account: () => (signedIn ? ACCOUNT : null),
        verify_login_code: () => {
          signedIn = true;
        },
      });

      fireEvent.change(input, { target: { value: "123456" } });

      expect(await screen.findByText(ACCOUNT.email)).toBeInTheDocument();
      expect(invoke).toHaveBeenCalledWith("verify_login_code", {
        email: "someone@example.com",
        code: "123456",
      });
      expect(onEmail).toHaveBeenLastCalledWith(ACCOUNT.email);
    });

    it("keeps digits only, so a pasted code with spaces works", async () => {
      const input = await atTheCode({ verify_login_code: refuse("relay_invalid_code") });

      fireEvent.change(input, { target: { value: "12 34" } });

      expect(input).toHaveValue("1234");
      expect(invoke).not.toHaveBeenCalledWith("verify_login_code", expect.anything());
    });

    it("clears a wrong code and explains", async () => {
      const input = await atTheCode({ verify_login_code: refuse("relay_invalid_code") });

      fireEvent.change(input, { target: { value: "000000" } });

      expect(await screen.findByRole("alert")).toHaveTextContent(/wrong or expired/i);
      expect(input).toHaveValue("");
    });

    it("goes back to change the address", async () => {
      await atTheCode();

      await userEvent.click(screen.getByRole("button", { name: /change address/i }));

      expect(screen.getByRole("textbox", { name: /email address/i })).toBeInTheDocument();
    });

    it("only allows a new code after a delay", async () => {
      vi.useFakeTimers();
      relay({ get_account: () => null });
      render(<AccountSection onEmail={onEmail} />);
      await act(() => vi.advanceTimersByTimeAsync(0));
      fireEvent.change(screen.getByRole("textbox", { name: /email address/i }), {
        target: { value: "someone@example.com" },
      });
      fireEvent.click(screen.getByRole("button", { name: /get a code/i }));
      await act(() => vi.advanceTimersByTimeAsync(0));

      const resend = screen.getByRole("button", { name: /send again/i });
      expect(resend).toBeDisabled();
      expect(resend).toHaveTextContent(/in 30 s/i);

      for (let i = 0; i < 30; i += 1) {
        await act(() => vi.advanceTimersByTimeAsync(1000));
      }
      expect(resend).toBeEnabled();
      vi.mocked(invoke).mockClear();

      fireEvent.click(resend);

      expect(invoke).toHaveBeenCalledWith("request_login_code", {
        email: "someone@example.com",
      });
    });
  });

  describe("signed in", () => {
    it("shows the address, the plan and what is used", async () => {
      relay({ get_account: () => ACCOUNT });
      render(<AccountSection onEmail={onEmail} />);

      expect(await screen.findByText(ACCOUNT.email)).toBeInTheDocument();
      expect(screen.getByText(/free plan/i)).toBeInTheDocument();
      expect(screen.getByText("12 / 20")).toBeInTheDocument();
      expect(screen.getByText("4 / 6")).toBeInTheDocument();
      expect(screen.getByText(/ends the oldest link/i)).toBeInTheDocument();
    });

    it("opens the account page on the website", async () => {
      relay({ get_account: () => ACCOUNT });
      render(<AccountSection onEmail={onEmail} />);

      await userEvent.click(await screen.findByRole("button", { name: /^open$/i }));

      expect(openUrl).toHaveBeenCalledWith(ACCOUNT_PAGE);
      expect(ACCOUNT_PAGE).toBe("https://snap2link.app/account/");
    });

    it("updates the counters when the window comes back", async () => {
      let today = 12;
      relay({ get_account: () => ({ ...ACCOUNT, captures_today: today }) });
      render(<AccountSection onEmail={onEmail} />);
      await screen.findByText("12 / 20");

      today = 13;
      fireEvent.focus(window);

      expect(await screen.findByText("13 / 20")).toBeInTheDocument();
    });

    it("signs out", async () => {
      let signedIn = true;
      relay({
        get_account: () => (signedIn ? ACCOUNT : null),
        sign_out: () => {
          signedIn = false;
        },
      });
      render(<AccountSection onEmail={onEmail} />);

      await userEvent.click(await screen.findByRole("button", { name: /sign out/i }));

      expect(await screen.findByRole("textbox", { name: /email address/i })).toBeInTheDocument();
      expect(onEmail).toHaveBeenLastCalledWith("");
    });

    it("asks before deleting, and Cancel changes nothing", async () => {
      relay({ get_account: () => ACCOUNT });
      render(<AccountSection onEmail={onEmail} />);

      await userEvent.click(await screen.findByRole("button", { name: /delete account/i }));
      expect(screen.getByText(/can't be undone/i)).toBeInTheDocument();
      expect(invoke).not.toHaveBeenCalledWith("delete_account");

      await userEvent.click(screen.getByRole("button", { name: /cancel/i }));

      expect(screen.getByRole("button", { name: /delete account/i })).toBeInTheDocument();
      expect(invoke).not.toHaveBeenCalledWith("delete_account");
    });

    it("deletes once confirmed", async () => {
      let exists = true;
      relay({
        get_account: () => (exists ? ACCOUNT : null),
        delete_account: () => {
          exists = false;
        },
      });
      render(<AccountSection onEmail={onEmail} />);

      await userEvent.click(await screen.findByRole("button", { name: /delete account/i }));
      await userEvent.click(screen.getByRole("button", { name: /^delete$/i }));

      expect(await screen.findByRole("textbox", { name: /email address/i })).toBeInTheDocument();
    });

    it("stays signed in when the deletion fails, and says why", async () => {
      relay({ get_account: () => ACCOUNT, delete_account: refuse("relay_unreachable") });
      render(<AccountSection onEmail={onEmail} />);

      await userEvent.click(await screen.findByRole("button", { name: /delete account/i }));
      await userEvent.click(screen.getByRole("button", { name: /^delete$/i }));

      expect(await screen.findByRole("alert")).toHaveTextContent(/can't be reached/i);
      expect(screen.getByText(ACCOUNT.email)).toBeInTheDocument();
    });
  });

  it("offers a retry when the account can't be loaded", async () => {
    let online = false;
    relay({
      get_account: () => {
        if (!online) throw "relay_unreachable";
        return ACCOUNT;
      },
    });
    render(<AccountSection onEmail={onEmail} />);

    const retry = await screen.findByRole("button", { name: /try again/i });
    expect(onEmail).not.toHaveBeenCalled();

    online = true;
    await userEvent.click(retry);

    await waitFor(() => expect(screen.getByText(ACCOUNT.email)).toBeInTheDocument());
  });
});
