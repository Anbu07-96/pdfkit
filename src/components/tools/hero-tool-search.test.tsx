import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRouter } from "next/navigation";
import { describe, expect, it, vi } from "vitest";
import { HeroToolSearch } from "@/components/tools/hero-tool-search";

describe("HeroToolSearch", () => {
  it("shows suggestions before a query is entered", () => {
    render(<HeroToolSearch />);
    expect(screen.getByRole("searchbox", { name: /what do you want to do/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "merge" })).toBeInTheDocument();
  });

  it("shows matching tools immediately while typing", async () => {
    const user = userEvent.setup();
    render(<HeroToolSearch />);

    await user.type(screen.getByRole("searchbox"), "compress");

    expect(screen.getByRole("link", { name: /compress pdf/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /see all matching tools/i })).toHaveAttribute(
      "href",
      "/tools?q=compress",
    );
  });

  it("fills the query from a suggestion", async () => {
    const user = userEvent.setup();
    render(<HeroToolSearch />);

    await user.click(screen.getByRole("button", { name: "ocr" }));

    expect(screen.getByRole("searchbox")).toHaveValue("ocr");
    expect(screen.getByRole("link", { name: /ocr document/i })).toBeInTheDocument();
  });

  it("shows a no-results state with a clear action", async () => {
    const user = userEvent.setup();
    render(<HeroToolSearch />);

    await user.type(screen.getByRole("searchbox"), "qqqq");
    expect(screen.getByText(/no tools match/i)).toBeInTheDocument();

    const clearButtons = screen.getAllByRole("button", { name: /clear search/i });
    await user.click(clearButtons[clearButtons.length - 1]);
    expect(screen.getByRole("searchbox")).toHaveValue("");
  });

  it("submits to the full catalog", async () => {
    const user = userEvent.setup();
    render(<HeroToolSearch />);

    await user.type(screen.getByRole("searchbox"), "jpg{Enter}");

    expect(vi.mocked(useRouter)().push).toHaveBeenCalledWith("/tools?q=jpg");
  });
});
