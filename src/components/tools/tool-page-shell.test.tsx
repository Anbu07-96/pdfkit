import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ToolPageShell } from "@/components/tools/tool-page-shell";
import { getTool } from "@/lib/tools";

const mergeTool = getTool("merge-pdf")!;
const plannedTool = getTool("pdf-to-word")!;

describe("ToolPageShell", () => {
  it("renders the workspace for an implemented tool", () => {
    render(
      <ToolPageShell
        tool={mergeTool}
        workspace={<div data-testid="workspace">workspace</div>}
      />,
    );

    expect(screen.getByTestId("workspace")).toBeInTheDocument();
    expect(screen.queryByText(/is not available yet/i)).not.toBeInTheDocument();
    expect(screen.getByText(/server-side, in memory/i)).toBeInTheDocument();
  });

  it("keeps the disabled area for a tool without an implementation", () => {
    render(<ToolPageShell tool={plannedTool} />);

    expect(screen.getByTestId("upload-zone")).toHaveAttribute("data-state", "disabled");
    expect(screen.getByText(/pdf to word is not available yet/i)).toBeInTheDocument();
  });

  it("ignores a workspace passed for a tool that is not usable", () => {
    render(
      <ToolPageShell
        tool={plannedTool}
        workspace={<div data-testid="workspace">should not render</div>}
      />,
    );

    expect(screen.queryByTestId("workspace")).not.toBeInTheDocument();
  });

  it("points a coming-soon page at the tools that do work", () => {
    render(<ToolPageShell tool={plannedTool} />);

    const links = screen.getAllByRole("link", { name: /merge pdf/i });
    expect(links.some((link) => link.getAttribute("href") === "/tools/merge-pdf")).toBe(
      true,
    );
    expect(screen.getByText(/working today/i)).toBeInTheDocument();
  });
});
