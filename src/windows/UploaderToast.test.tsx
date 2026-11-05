import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { UploaderToast } from "./UploaderToast";
import { ToastWindow } from "./ToastWindow";

describe("<UploaderToast />", () => {
  it("shows a spinner and no Delete button while uploading", () => {
    render(<UploaderToast state="uploading" />);
    expect(screen.getByText(/uploading your capture/i)).toBeInTheDocument();
    expect(screen.getByTestId("uploader-spinner")).toBeInTheDocument();
    expect(screen.queryByTestId("toast-delete")).not.toBeInTheDocument();
  });

  it("offers Delete once the link is copied", () => {
    const onDelete = vi.fn();
    render(<UploaderToast state="copied" onDelete={onDelete} />);
    expect(screen.getByText(/link copied/i)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("toast-delete"));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("offers a retry when the deletion failed", () => {
    render(<UploaderToast state="delete_failed" />);
    expect(screen.getByText(/still works/i)).toBeInTheDocument();
    expect(screen.getByTestId("toast-delete")).toBeEnabled();
  });

  it("drops the button once deleted", () => {
    render(<UploaderToast state="deleted" />);
    expect(screen.getByText(/no longer works/i)).toBeInTheDocument();
    expect(screen.queryByTestId("toast-delete")).not.toBeInTheDocument();
  });
});

describe("<ToastWindow />", () => {
  async function showCopied() {
    let push: (e: { payload: string }) => void = () => {};
    vi.mocked(listen).mockImplementation((async (
      _name: string,
      cb: (e: { payload: string }) => void,
    ) => {
      push = cb;
      return () => {};
    }) as never);
    render(<ToastWindow />);
    await waitFor(() => expect(listen).toHaveBeenCalled());
    push({ payload: "copied" });
    return screen.findByTestId("toast-delete");
  }

  it("deletes the capture that was just shared", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    fireEvent.click(await showCopied());

    expect(await screen.findByText(/capture deleted/i)).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("delete_last_upload");
  });

  it("says so when the deletion fails", async () => {
    vi.mocked(invoke).mockRejectedValue("nope");
    fireEvent.click(await showCopied());

    expect(await screen.findByText(/could not delete/i)).toBeInTheDocument();
  });
});
