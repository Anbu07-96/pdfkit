import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PdfToTextWorkspace } from "@/components/tools/workspaces/pdf-to-text-workspace";
import { ToastProvider } from "@/components/ui/toast";

describe("PdfToTextWorkspace", () => {
  it("renders upload zone initially", () => {
    render(
      <ToastProvider>
        <PdfToTextWorkspace limits={{ maxFileSize: 25 * 1024 * 1024 }} />
      </ToastProvider>,
    );
    expect(screen.getAllByText(/upload a pdf/i)[0]).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^convert to text$/i })).toBeDisabled();
  });
});
