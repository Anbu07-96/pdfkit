import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ToolPageShell } from "@/components/tools/tool-page-shell";
import { getTool } from "@/lib/tools";

const mergeTool = getTool("merge-pdf")!;
const plannedTool = getTool("word-to-pdf")!;

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
    expect(screen.getByText(/word to pdf is not available yet/i)).toBeInTheDocument();
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

  it("compact variant: one Trust & details card with a full-privacy disclosure (Phase 75D.5)", () => {
    render(
      <ToolPageShell
        tool={mergeTool}
        variant="compact"
        workspace={<div data-testid="workspace">workspace</div>}
      />,
    );

    // A single compact card replaces the two stacked sidebar cards…
    expect(screen.getByText("Trust & details")).toBeInTheDocument();
    expect(
      screen.queryByText(/^privacy information$/i),
    ).not.toBeInTheDocument();
    // …with the essentials always visible…
    expect(screen.getByText(/Private processing/i)).toBeInTheDocument();
    expect(
      screen.getAllByText(/server-side, in memory/i).length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByText(/discarded as soon as the result is returned/i)
        .length,
    ).toBeGreaterThanOrEqual(1);
    // …and the full privacy text available through the disclosure.
    expect(screen.getByText(/full privacy information/i)).toBeInTheDocument();
    expect(
      screen.getAllByText(/never written to disk/i).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("compact variant: metadata collapses into the card", () => {
    render(
      <ToolPageShell
        tool={mergeTool}
        variant="compact"
        workspace={<div data-testid="workspace">workspace</div>}
      />,
    );
    expect(screen.getByText("Category")).toBeInTheDocument();
    expect(screen.getAllByText("Organize PDF").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Processing")).toBeInTheDocument();
  });

  it("default variant keeps the classic two-card sidebar for other tools", () => {
    render(
      <ToolPageShell
        tool={mergeTool}
        workspace={<div data-testid="workspace">workspace</div>}
      />,
    );
    expect(screen.getByText(/privacy information/i)).toBeInTheDocument();
    expect(screen.queryByText(/trust & details/i)).not.toBeInTheDocument();
  });
});
