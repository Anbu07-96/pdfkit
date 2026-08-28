import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RedactWorkspace } from "@/components/tools/workspaces/redact-workspace";

describe("RedactWorkspace", () => {
  it("renders upload zone correctly", () => {
    render(<RedactWorkspace />);
    expect(screen.getByText(/Upload your files/i)).toBeInTheDocument();
  });
});
