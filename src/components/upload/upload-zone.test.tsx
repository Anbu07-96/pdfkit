import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { UploadZone } from "@/components/upload/upload-zone";

function pdf(name = "document.pdf", size = 1024) {
  const file = new File(["x".repeat(size)], name, { type: "application/pdf" });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

describe("UploadZone", () => {
  it("renders the empty state with a browse action", () => {
    render(<UploadZone extensions={[".pdf"]} maxFileSize={1024 * 1024} />);

    const zone = screen.getByTestId("upload-zone");
    expect(zone).toHaveAttribute("data-state", "empty");
    expect(screen.getByRole("button", { name: /browse files/i })).toBeInTheDocument();
    expect(screen.getByText(/drag and drop files here/i)).toBeInTheDocument();
    expect(screen.getByText(/PDF files/)).toBeInTheDocument();
  });

  it("lists selected files and reports them to the caller", async () => {
    const user = userEvent.setup();
    const onFilesChange = vi.fn();
    render(<UploadZone extensions={[".pdf"]} onFilesChange={onFilesChange} />);

    const input = screen.getByLabelText(/upload your files/i);
    await user.upload(input, pdf("report.pdf", 2048));

    expect(screen.getByText("report.pdf")).toBeInTheDocument();
    expect(screen.getByText("1 file selected")).toBeInTheDocument();
    expect(screen.getByTestId("upload-zone")).toHaveAttribute("data-state", "selected");
    expect(onFilesChange).toHaveBeenCalledTimes(1);
    expect(onFilesChange.mock.calls[0][0]).toHaveLength(1);
  });

  it("removes a selected file", async () => {
    const user = userEvent.setup();
    render(<UploadZone extensions={[".pdf"]} />);

    await user.upload(screen.getByLabelText(/upload your files/i), pdf("report.pdf"));
    await user.click(screen.getByRole("button", { name: /remove report\.pdf/i }));

    expect(screen.queryByText("report.pdf")).not.toBeInTheDocument();
    expect(screen.getByTestId("upload-zone")).toHaveAttribute("data-state", "empty");
  });

  it("shows an error state for rejected files", () => {
    render(<UploadZone extensions={[".pdf"]} mimeTypes={["application/pdf"]} />);

    const image = new File(["x"], "photo.png", { type: "image/png" });
    // fireEvent bypasses the browser accept filter, simulating a file that
    // arrives anyway (drag and drop, or a browser ignoring the attribute).
    fireEvent.change(screen.getByLabelText(/upload your files/i), {
      target: { files: [image] },
    });

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/1 file was not added/i);
    expect(alert).toHaveTextContent(/photo\.png is not a supported file type/i);
  });

  it("enforces the maximum file size", async () => {
    const user = userEvent.setup();
    render(<UploadZone extensions={[".pdf"]} maxFileSize={100} />);

    await user.upload(screen.getByLabelText(/upload your files/i), pdf("big.pdf", 5000));

    expect(screen.getByRole("alert")).toHaveTextContent(/larger than the maximum/i);
  });

  it("blocks selection when disabled and explains why", () => {
    render(
      <UploadZone
        extensions={[".pdf"]}
        disabled
        disabledBadge="Coming soon"
        disabledReason="Processing for this tool has not been built."
      />,
    );

    expect(screen.getByTestId("upload-zone")).toHaveAttribute("data-state", "disabled");
    expect(screen.queryByRole("button", { name: /browse files/i })).not.toBeInTheDocument();
    expect(screen.getByText("Coming soon")).toBeInTheDocument();
    expect(
      screen.getByText(/processing for this tool has not been built/i),
    ).toBeInTheDocument();
  });
});
