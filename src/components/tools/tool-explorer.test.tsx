import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ToolExplorer } from "@/components/tools/tool-explorer";
import { TOOLS } from "@/lib/tools";

describe("ToolExplorer", () => {
  it("lists the whole catalog before searching", () => {
    render(<ToolExplorer />);
    expect(screen.getByRole("status")).toHaveTextContent(
      `${TOOLS.length} tools in the catalog`,
    );
    expect(screen.getByRole("link", { name: /merge pdf/i })).toBeInTheDocument();
  });

  it("filters results as the user types", async () => {
    const user = userEvent.setup();
    render(<ToolExplorer />);

    await user.type(screen.getByRole("searchbox", { name: /search tools/i }), "merge");

    expect(screen.getByRole("link", { name: /merge pdf/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /compress pdf/i })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/matching/i);
  });

  it("shows a no-results state and can be cleared", async () => {
    const user = userEvent.setup();
    render(<ToolExplorer />);

    const searchbox = screen.getByRole("searchbox", { name: /search tools/i });
    await user.type(searchbox, "zzzzz");

    expect(screen.getByText(/no tools found/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /clear search and filters/i }));

    expect(searchbox).toHaveValue("");
    expect(screen.getByRole("link", { name: /merge pdf/i })).toBeInTheDocument();
  });

  it("clears the query with the Escape key", async () => {
    const user = userEvent.setup();
    render(<ToolExplorer />);

    const searchbox = screen.getByRole("searchbox", { name: /search tools/i });
    await user.type(searchbox, "ocr");
    expect(searchbox).toHaveValue("ocr");

    await user.keyboard("{Escape}");
    expect(searchbox).toHaveValue("");
  });

  it("filters by category", async () => {
    const user = userEvent.setup();
    render(<ToolExplorer />);

    await user.click(screen.getByRole("button", { name: "Security" }));

    expect(screen.getByRole("button", { name: "Security" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("link", { name: /password protect/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /merge pdf/i })).not.toBeInTheDocument();
  });

  it("starts from an initial query", () => {
    render(<ToolExplorer initialQuery="word" />);
    expect(screen.getByRole("link", { name: /word to pdf/i })).toBeInTheDocument();
  });
});
