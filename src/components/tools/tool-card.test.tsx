import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ToolCard } from "@/components/tools/tool-card";
import { ToolStatusBadge } from "@/components/tools/tool-status-badge";
import { getTool } from "@/lib/tools";

const mergeTool = getTool("merge-pdf")!;
const aiTool = getTool("summarize-pdf")!;

describe("ToolCard", () => {
  it("links to the tool page and describes the tool", () => {
    render(
      <ul>
        <ToolCard tool={mergeTool} />
      </ul>,
    );

    const link = screen.getByRole("link", { name: /merge pdf/i });
    expect(link).toHaveAttribute("href", "/tools/merge-pdf");
    expect(screen.getByText(mergeTool.description)).toBeInTheDocument();
  });

  it("communicates that the tool is not available yet", () => {
    render(
      <ul>
        <ToolCard tool={mergeTool} />
      </ul>,
    );
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
  });

  it("marks tools planned for a paid plan without implying access", () => {
    render(
      <ul>
        <ToolCard tool={aiTool} />
      </ul>,
    );
    expect(screen.getByText("Coming soon · Pro")).toBeInTheDocument();
  });
});

describe("ToolStatusBadge", () => {
  it("uses text, not colour alone, for each state", () => {
    const { rerender } = render(<ToolStatusBadge status="AVAILABLE" />);
    expect(screen.getByText("Available")).toBeInTheDocument();

    rerender(<ToolStatusBadge status="COMING_SOON" />);
    expect(screen.getByText("Coming soon")).toBeInTheDocument();

    rerender(<ToolStatusBadge status="PRO" />);
    expect(screen.getByText("Pro")).toBeInTheDocument();

    rerender(<ToolStatusBadge status="DISABLED" />);
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
  });
});
