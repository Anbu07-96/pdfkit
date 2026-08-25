import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DrawWorkspace } from "@/components/tools/workspaces/draw-workspace";
import { ToastProvider } from "@/components/ui/toast";

describe("DrawWorkspace", () => {
  it("renders initial state", () => {
    render(
      <ToastProvider>
        <DrawWorkspace limits={{ maxFileSize: 25 * 1024 * 1024 }} />
      </ToastProvider>,
    );
    expect(screen.getAllByText(/upload a pdf/i)[0]).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^draw on pdf$/i })).toBeDisabled();
  });
});
