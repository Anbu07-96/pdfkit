import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CompareDocumentsWorkspace } from "@/components/tools/workspaces/compare-documents-workspace";

describe("CompareDocumentsWorkspace", () => {
  it("renders upload zone correctly", () => {
    render(<CompareDocumentsWorkspace />);
    expect(screen.getByText(/Upload your files/i)).toBeInTheDocument();
  });
});
