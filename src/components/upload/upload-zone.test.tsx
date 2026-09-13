import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { UploadZone, type SelectedFile } from "@/components/upload/upload-zone";

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

describe("UploadZone ordering", () => {
  function ControlledZone() {
    const [files, setFiles] = React.useState<SelectedFile[]>([]);
    return (
      <UploadZone
        extensions={[".pdf"]}
        files={files}
        onFilesChange={setFiles}
        orderable
      />
    );
  }

  async function addTwo(user: ReturnType<typeof userEvent.setup>) {
    const input = screen.getByLabelText(/upload your files/i);
    await user.upload(input, pdf("first.pdf"));
    await user.upload(input, pdf("second.pdf"));
  }

  it("numbers files and exposes accessible move controls", async () => {
    const user = userEvent.setup();
    render(<ControlledZone />);
    await addTwo(user);

    expect(screen.getByText(/documents are processed in this order/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /move first\.pdf up/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /move first\.pdf down/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /move second\.pdf down/i })).toBeDisabled();
  });

  it("moves a file down and back up again", async () => {
    const user = userEvent.setup();
    render(<ControlledZone />);
    await addTwo(user);

    const names = () =>
      within(screen.getByRole("region", { name: /selected files/i }))
        .getAllByText(/\.pdf$/)
        .map((node) => node.textContent);

    expect(names()).toEqual(["first.pdf", "second.pdf"]);

    await user.click(screen.getByRole("button", { name: /move first\.pdf down/i }));
    expect(names()).toEqual(["second.pdf", "first.pdf"]);

    await user.click(screen.getByRole("button", { name: /move first\.pdf up/i }));
    expect(names()).toEqual(["first.pdf", "second.pdf"]);
  });

  it("locks the selection while the page is busy", async () => {
    const user = userEvent.setup();
    function BusyZone() {
      const [files, setFiles] = React.useState<SelectedFile[]>([]);
      return (
        <>
          <UploadZone
            extensions={[".pdf"]}
            files={files}
            onFilesChange={setFiles}
            orderable
            busy={files.length > 0}
          />
        </>
      );
    }

    render(<BusyZone />);
    await user.upload(screen.getByLabelText(/upload your files/i), pdf("a.pdf"));

    expect(screen.getByTestId("upload-zone")).toHaveAttribute("data-state", "busy");
    expect(screen.getByRole("button", { name: /browse files/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /remove a\.pdf/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /remove all/i })).toBeDisabled();
  });
  describe("compact variant (Phase 75D.5)", () => {
    it("collapses the drop zone into a slim replace strip once a file is selected", async () => {
      const user = userEvent.setup();
      function StatefulZone() {
        const [files, setFiles] = React.useState<SelectedFile[]>([]);
        return (
          <UploadZone
            files={files}
            onFilesChange={setFiles}
            multiple={false}
            maxFiles={1}
            variant="compact"
            showFileList={false}
          />
        );
      }
      render(<StatefulZone />);

      const zone = screen.getByTestId("upload-zone");
      expect(zone).toHaveAttribute("data-state", "empty");
      expect(zone).not.toHaveAttribute("data-collapsed");

      await user.upload(screen.getByLabelText(/upload your files/i), pdf());
      expect(zone).toHaveAttribute("data-state", "selected");
      expect(zone).toHaveAttribute("data-collapsed", "true");
      expect(zone).toHaveTextContent(/replace/i);
    });

    it("keeps the classic spacious zone in the default variant", async () => {
      const user = userEvent.setup();
      render(
        <UploadZone multiple={false} maxFiles={1} />,
      );
      await user.upload(screen.getByLabelText(/upload your files/i), pdf());
      const zone = screen.getByTestId("upload-zone");
      expect(zone).toHaveAttribute("data-state", "selected");
      expect(zone).not.toHaveAttribute("data-collapsed");
      expect(zone).toHaveTextContent(/browse/i);
    });

    it("can hide the built-in file list for workspaces with their own file row", async () => {
      const user = userEvent.setup();
      render(
        <UploadZone multiple={false} maxFiles={1} showFileList={false} />,
      );
      await user.upload(screen.getByLabelText(/upload your files/i), pdf());
      expect(screen.queryByRole("region", { name: /selected files/i })).toBeNull();
    });
  });
});
