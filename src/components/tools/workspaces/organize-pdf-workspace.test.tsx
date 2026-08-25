import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OrganizePdfWorkspace } from "@/components/tools/workspaces/organize-pdf-workspace";
import { ToastProvider } from "@/components/ui/toast";

describe("OrganizePdfWorkspace", () => {
  it("renders initial upload state", () => {
    render(
      <ToastProvider>
        <OrganizePdfWorkspace limits={{ maxFileSize: 25 * 1024 * 1024, thumbnailMaxPages: 60 }} />
      </ToastProvider>,
    );
    expect(screen.getAllByText(/upload a pdf/i)[0]).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^organize pdf$/i })).toBeDisabled();
  });
});
