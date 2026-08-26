import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ExtractTablesWorkspace } from "@/components/tools/workspaces/extract-tables-workspace";

describe("ExtractTablesWorkspace", () => {
  it("renders upload zone correctly", () => {
    render(<ExtractTablesWorkspace />);
    expect(screen.getByText(/Upload your files/i)).toBeInTheDocument();
  });
});
