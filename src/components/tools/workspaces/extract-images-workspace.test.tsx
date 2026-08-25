import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ExtractImagesWorkspace } from "@/components/tools/workspaces/extract-images-workspace";
import { ToastProvider } from "@/components/ui/toast";

describe("ExtractImagesWorkspace", () => {
  it("renders upload zone initially", () => {
    render(
      <ToastProvider>
        <ExtractImagesWorkspace limits={{ maxFileSize: 25 * 1024 * 1024 }} />
      </ToastProvider>,
    );
    expect(screen.getAllByText(/upload a pdf/i)[0]).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^extract images$/i })).toBeDisabled();
  });
});
