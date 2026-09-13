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

  it("compact variant: a quiet trust line with the full policy one disclosure away (Phase 75D.6)", () => {
    render(
      <ToolPageShell
        tool={mergeTool}
        variant="compact"
        workspace={<div data-testid="workspace">workspace</div>}
      />,
    );

    // No sidebar, no "Privacy information" card, no metadata table…
    expect(screen.queryByText(/^privacy information$/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Category")).not.toBeInTheDocument();
    // …just the essentials, stated as a fact under the workspace…
    expect(screen.getByText("Private")).toBeInTheDocument();
    expect(screen.getAllByText(/Processed in memory/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/discarded as soon as the result is returned/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/no account, tracking or advertising/i)).toBeInTheDocument();
    // …with the full policy behind the disclosure.
    expect(screen.getByText(/full privacy details/i)).toBeInTheDocument();
    expect(
      screen.getAllByText(/never written to disk/i).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("compact variant: open sections, no card grids (Phase 75D.6)", () => {
    render(
      <ToolPageShell
        tool={mergeTool}
        variant="compact"
        workspace={<div data-testid="workspace">workspace</div>}
      />,
    );
    // The workspace renders…
    expect(screen.getByTestId("workspace")).toBeInTheDocument();
    // …sections are labeled with quiet eyebrows instead of big headings…
    expect(screen.getByText("How it works")).toBeInTheDocument();
    expect(screen.getByText("Related tools")).toBeInTheDocument();
    expect(screen.getByText("Frequently asked questions")).toBeInTheDocument();
    // …steps use mono numerals, not circled badges…
    expect(screen.getByText("01")).toBeInTheDocument();
    // …and related tools are text links, not a card grid.
    expect(screen.getByRole("link", { name: /split pdf/i })).toBeInTheDocument();
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
