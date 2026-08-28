import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AnnotationsWorkspace } from "@/components/tools/workspaces/annotations-workspace";
import { ToastProvider } from "@/components/ui/toast";

describe("AnnotationsWorkspace", () => {
  it("renders initial state", () => {
    render(
      <ToastProvider>
        <AnnotationsWorkspace limits={{ maxFileSize: 25 * 1024 * 1024 }} />
      </ToastProvider>,
    );
    expect(screen.getAllByText(/upload a pdf/i)[0]).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^add annotation$/i })).toBeDisabled();
  });
});
