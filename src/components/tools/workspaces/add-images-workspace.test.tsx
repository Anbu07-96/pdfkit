import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AddImagesWorkspace } from "@/components/tools/workspaces/add-images-workspace";
import { ToastProvider } from "@/components/ui/toast";

describe("AddImagesWorkspace", () => {
  it("renders upload zone for PDF initially", () => {
    render(
      <ToastProvider>
        <AddImagesWorkspace limits={{ maxFileSize: 25 * 1024 * 1024 }} />
      </ToastProvider>,
    );
    expect(screen.getAllByText(/upload a pdf/i)[0]).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^add image$/i })).toBeDisabled();
  });
});
