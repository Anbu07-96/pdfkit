import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HighlightWorkspace } from "@/components/tools/workspaces/highlight-workspace";
import { ToastProvider } from "@/components/ui/toast";

describe("HighlightWorkspace", () => {
  it("renders initial state", () => {
    render(
      <ToastProvider>
        <HighlightWorkspace limits={{ maxFileSize: 25 * 1024 * 1024 }} />
      </ToastProvider>,
    );
    expect(screen.getAllByText(/upload a pdf/i)[0]).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^highlight pdf$/i })).toBeDisabled();
  });
});
