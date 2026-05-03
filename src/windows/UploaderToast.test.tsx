import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { UploaderToast } from "./UploaderToast";

describe("<UploaderToast />", () => {
  it("renders the uploading state with spinner and uploading text", () => {
    render(<UploaderToast state="uploading" />);
    expect(screen.getByText(/uploading to google drive/i)).toBeInTheDocument();
    expect(screen.getByTestId("uploader-spinner")).toBeInTheDocument();
    expect(screen.queryByTestId("uploader-check")).not.toBeInTheDocument();
  });

  it("renders the success state with green check and confirmation text", () => {
    render(<UploaderToast state="success" />);
    expect(screen.getByText(/link copied/i)).toBeInTheDocument();
    expect(
      screen.getByText(/the screenshot link is in your clipboard/i),
    ).toBeInTheDocument();
    expect(screen.getByTestId("uploader-check")).toBeInTheDocument();
    expect(screen.queryByTestId("uploader-spinner")).not.toBeInTheDocument();
  });

  it("has a status role for screen readers", () => {
    render(<UploaderToast state="uploading" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
