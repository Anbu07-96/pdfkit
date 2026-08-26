import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PdfToExcelWorkspace } from "@/components/tools/workspaces/pdf-to-excel-workspace";

describe("PdfToExcelWorkspace", () => {
  it("renders upload zone correctly", () => {
    render(<PdfToExcelWorkspace />);
    expect(screen.getByText(/Upload your files/i)).toBeInTheDocument();
  });
});
