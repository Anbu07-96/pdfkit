import { render, screen, within, fireEvent, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DesktopNav } from "@/components/layout/desktop-nav";
import { MobileNav } from "@/components/layout/mobile-nav";
import { primaryNav } from "@/lib/config/site";
import {
  TOOL_CATEGORIES,
  getToolsByCategory,
  isToolUsable,
} from "@/lib/tools";

/** The primary-nav entries that are categories (dropdown targets). */
const CATEGORY_NAV = primaryNav.flatMap((item) => {
  const category = TOOL_CATEGORIES.find((c) => c.route === item.href);
  return category ? [{ item, category }] : [];
});
const NON_CATEGORY_NAV = primaryNav.filter(
  (item) => !CATEGORY_NAV.some((entry) => entry.item.href === item.href),
);

function categoryButton(name: string): HTMLButtonElement {
  return screen.getByRole("button", { name: new RegExp(`^${name}`, "i") });
}

/**
 * Accessible names carry descriptions now (and jsdom concatenates the
 * spans without whitespace), so match the leading label only. Safe here:
 * no catalog tool name is a prefix of another tool's name.
 */
function nameStartsWith(name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}`);
}

function openCategoryPanel(user: ReturnType<typeof userEvent.setup>, label: string) {
  return user.hover(categoryButton(label));
}

describe("desktop navigation", () => {
  it("renders every non-category link", () => {
    render(<DesktopNav />);
    const nav = screen.getByRole("navigation", { name: "Main" });

    for (const item of NON_CATEGORY_NAV) {
      const link = within(nav).getByRole("link", { name: nameStartsWith(item.label) });
      expect(link).toHaveAttribute("href", item.href);
    }
  });

  it("renders every category as a dropdown trigger", () => {
    render(<DesktopNav />);
    for (const { item } of CATEGORY_NAV) {
      expect(
        screen.getByRole("button", { name: new RegExp(`^${item.label}`, "i") }),
      ).toHaveAttribute("aria-expanded", "false");
    }
    // No category panel is open by default.
    expect(screen.queryByRole("link", { name: /view all/i })).not.toBeInTheDocument();
  });

  it("hovering a category opens its tools; hovering another category switches", async () => {
    const user = userEvent.setup();
    render(<DesktopNav />);

    const first = CATEGORY_NAV[0];
    await openCategoryPanel(user, first.item.label);
    expect(categoryButton(first.item.label)).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("link", { name: `View all ${first.category.name} tools` }),
    ).toHaveAttribute("href", first.category.route);

    const second = CATEGORY_NAV[1];
    await openCategoryPanel(user, second.item.label);
    expect(categoryButton(second.item.label)).toHaveAttribute("aria-expanded", "true");
    expect(categoryButton(first.item.label)).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.getByRole("link", { name: `View all ${second.category.name} tools` }),
    ).toBeInTheDocument();
  });

  it("shows a category heading strip with the catalog tool count", async () => {
    const user = userEvent.setup();
    render(<DesktopNav />);
    const first = CATEGORY_NAV[0];
    await openCategoryPanel(user, first.item.label);

    const panel = document.getElementById(
      `nav-panel-${first.category.id}`,
    )!;
    expect(within(panel).getByText(first.category.name)).toBeInTheDocument();
    const available = getToolsByCategory(first.category.id).filter(isToolUsable);
    expect(within(panel).getByText(first.category.description)).toBeInTheDocument();
    expect(
      within(panel).getByText(
        `${available.length} ${available.length === 1 ? "tool" : "tools"} available`,
      ),
    ).toBeInTheDocument();
  });

  it("renders available tools as compact cards — icon, name and description in a grid", async () => {
    const user = userEvent.setup();
    render(<DesktopNav />);
    const first = CATEGORY_NAV[0];
    const available = getToolsByCategory(first.category.id).filter(isToolUsable);
    if (available.length === 0) throw new Error("pick a category with available tools");
    await openCategoryPanel(user, first.item.label);

    const panel = document.getElementById(`nav-panel-${first.category.id}`)!;
    // The tools sit in a responsive multi-column grid, not stacked rows.
    const grid = panel.querySelector("ul");
    expect(grid?.className).toContain("grid");
    expect(grid?.className).toContain("sm:grid-cols-2");

    for (const tool of available) {
      const link = within(panel).getByRole("link", {
        name: nameStartsWith(tool.name),
      });
      // Hierarchy inside the card: decorative icon + name + description.
      expect(within(link).getByText(tool.name)).toBeInTheDocument();
      expect(within(link).getByText(tool.description)).toBeInTheDocument();
      expect(link.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("renders coming-soon tools as dashed, non-interactive chips in a labeled section", async () => {
    const user = userEvent.setup();
    render(<DesktopNav />);
    const first = CATEGORY_NAV[0];
    const comingSoon = getToolsByCategory(first.category.id).filter(
      (tool) => !isToolUsable(tool),
    );
    if (comingSoon.length === 0) throw new Error("pick a category with coming-soon tools");
    await openCategoryPanel(user, first.item.label);

    const panel = document.getElementById(`nav-panel-${first.category.id}`)!;
    expect(within(panel).getByText("Coming soon")).toBeInTheDocument();
    for (const tool of comingSoon) {
      const chip = within(panel).getByText(tool.name);
      expect(chip.closest("a")).toBeNull();
      expect(chip.closest("button")).toBeNull();
      // Dashed chip styling — visibly unlike the available-tool cards.
      expect(chip.closest("li")?.className).toContain("border-dashed");
    }
  });

  it("opening animates the panel box in; switching categories animates content only", async () => {
    const user = userEvent.setup();
    render(<DesktopNav />);
    const [first, second] = CATEGORY_NAV;

    // Opening from closed: the whole box animates in.
    await openCategoryPanel(user, first.item.label);
    const firstBox = document.getElementById(`nav-panel-${first.category.id}`);
    expect(firstBox?.className).toContain("nav-panel-in");

    // Switching: the old box unmounts and the new one mounts at the same
    // anchored position WITHOUT re-animating the box — only the content
    // cross-fades, so the container never blinks between categories.
    await openCategoryPanel(user, second.item.label);
    expect(document.getElementById(`nav-panel-${first.category.id}`)).toBeNull();
    const secondBox = document.getElementById(`nav-panel-${second.category.id}`);
    expect(secondBox?.className).not.toContain("nav-panel-in");
    expect(secondBox?.querySelector(".nav-panel-content-in")).not.toBeNull();

    // Keyboard switching is equally smooth: arrow-hopping between triggers
    // swaps content in place instead of closing and re-animating the box.
    act(() => {
      categoryButton(second.item.label).focus();
    });
    await user.keyboard("{ArrowLeft}");
    const firstBoxAgain = document.getElementById(
      `nav-panel-${first.category.id}`,
    );
    expect(firstBoxAgain?.className).not.toContain("nav-panel-in");
    expect(firstBoxAgain?.querySelector(".nav-panel-content-in")).not.toBeNull();
    // …and closing then reopening brings the box animation back.
    await user.keyboard("{Escape}");
    await openCategoryPanel(user, first.item.label);
    expect(
      document.getElementById(`nav-panel-${first.category.id}`)?.className,
    ).toContain("nav-panel-in");
  });

  it("caps the panel to the viewport and scrolls internally", async () => {
    const user = userEvent.setup();
    render(<DesktopNav />);
    const first = CATEGORY_NAV[0];
    await openCategoryPanel(user, first.item.label);

    const box = document.getElementById(`nav-panel-${first.category.id}`)!;
    expect(box.className).toContain("overflow-y-auto");
    expect(box.className).toMatch(/max-h-\[/);
    expect(box.className).toMatch(/max-w-\[/);
  });

  it("panel animations are CSS-only and disabled under prefers-reduced-motion", async () => {
    // The panel animates via CSS classes; the global stylesheet zeroes
    // every animation/transition duration for reduced-motion users, which
    // makes the menu fully instant with no JavaScript branch involved.
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toContain("animation-duration: 0.01ms");
    expect(css).toContain("transition-duration: 0.01ms");

    const navSource = readFileSync(
      join(process.cwd(), "src/components/layout/desktop-nav.tsx"),
      "utf8",
    );
    expect(navSource).toContain("nav-panel-in"); // CSS animation class
    expect(navSource).not.toMatch(/requestAnimationFrame|setInterval/); // no JS motion
  });

  it("each panel lists exactly the category's catalog tools — no duplicates", async () => {
    const user = userEvent.setup();
    render(<DesktopNav />);

    for (const { item, category } of CATEGORY_NAV) {
      await openCategoryPanel(user, item.label);

      const expected = getToolsByCategory(category.id);
      const available = expected.filter(isToolUsable);
      const comingSoon = expected.filter((tool) => !isToolUsable(tool));

      // Every usable tool is a link to its existing tool page, with the
      // catalog name — and nothing else is a tool link.
      const toolLinks = screen
        .getAllByRole("link")
        .filter((link) => link.getAttribute("href")?.startsWith("/tools/"));
      expect(toolLinks.map((link) => link.getAttribute("href"))).toEqual(
        available.map((tool) => tool.route),
      );
      for (const tool of available) {
        expect(
          screen.getByRole("link", { name: nameStartsWith(tool.name) }),
        ).toBeInTheDocument();
      }

      // Coming-soon tools are shown but never as links.
      for (const tool of comingSoon) {
        const row = screen.getByText(tool.name);
        expect(row.closest("a")).toBeNull();
      }
      if (comingSoon.length > 0) {
        expect(screen.getByText("Coming soon")).toBeInTheDocument();
      }

      // Hover straight to the next category (no gap in which the grace
      // timer could close the panel between iterations).
    }
  });

  it("shows an honest empty state for a category without available tools", async () => {
    const ocr = TOOL_CATEGORIES.find((category) => category.id === "ocr")!;
    const nav = primaryNav.find((item) => item.href === ocr.route);
    if (!nav || getToolsByCategory("ocr").some(isToolUsable)) {
      // If OCR ever gains available tools, point this test at another
      // category that has none.
      throw new Error("pick a category with no available tools for this test");
    }

    const user = userEvent.setup();
    render(<DesktopNav />);
    await openCategoryPanel(user, nav.label);

    expect(
      screen.getByText(/no tools available yet/i),
    ).toBeInTheDocument();
    // The coming-soon rows are still listed, honestly, as non-links.
    for (const tool of getToolsByCategory("ocr")) {
      expect(screen.getByText(tool.name).closest("a")).toBeNull();
    }
  });

  it("moving away from the nav closes the panel after a short grace delay", async () => {
    vi.useFakeTimers();
    try {
      const { container } = render(<DesktopNav />);
      const first = CATEGORY_NAV[0];

      act(() => {
        fireEvent.mouseEnter(categoryButton(first.item.label));
      });
      expect(categoryButton(first.item.label)).toHaveAttribute("aria-expanded", "true");

      // Leaving the nav starts the grace timer…
      act(() => {
        fireEvent.mouseLeave(container.querySelector('nav[aria-label="Main"]')!);
      });
      act(() => {
        vi.advanceTimersByTime(50);
      });
      expect(categoryButton(first.item.label)).toHaveAttribute("aria-expanded", "true");

      // …re-entering within the grace period cancels the close…
      act(() => {
        fireEvent.mouseEnter(categoryButton(first.item.label));
      });
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(categoryButton(first.item.label)).toHaveAttribute("aria-expanded", "true");

      // …and a real departure closes after the delay.
      act(() => {
        fireEvent.mouseLeave(container.querySelector('nav[aria-label="Main"]')!);
      });
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(categoryButton(first.item.label)).toHaveAttribute("aria-expanded", "false");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keyboard: focus opens the panel, Escape closes it, arrows move between categories", async () => {
    const user = userEvent.setup();
    render(<DesktopNav />);

    // Tab reaches the first category trigger; focusing it opens the panel.
    await user.tab(); // "Tools" link
    await user.tab(); // first category button
    const first = CATEGORY_NAV[0];
    expect(categoryButton(first.item.label)).toHaveFocus();
    expect(categoryButton(first.item.label)).toHaveAttribute("aria-expanded", "true");

    // ArrowRight hops to the next category and opens it.
    await user.keyboard("{ArrowRight}");
    const second = CATEGORY_NAV[1];
    expect(categoryButton(second.item.label)).toHaveFocus();
    expect(categoryButton(second.item.label)).toHaveAttribute("aria-expanded", "true");
    expect(categoryButton(first.item.label)).toHaveAttribute("aria-expanded", "false");

    // Escape closes and keeps focus on the trigger.
    await user.keyboard("{Escape}");
    expect(categoryButton(second.item.label)).toHaveAttribute("aria-expanded", "false");
    expect(categoryButton(second.item.label)).toHaveFocus();

    // Tab from an open panel reaches the panel's links (panel not a trap):
    // focus moves into the open panel's first link.
    await user.hover(categoryButton(second.item.label));
    await user.tab();
    const focused = document.activeElement as HTMLAnchorElement | null;
    expect(focused?.getAttribute("href")).toMatch(/^\/tools\/|^\/categories\//);
  });

  it("tap/click opens the panel and never closes what the same tap opened", async () => {
    const user = userEvent.setup();
    render(<DesktopNav />);
    const first = CATEGORY_NAV[0];
    const button = categoryButton(first.item.label);

    // A click (with its preceding hover/focus events) opens the panel…
    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");

    // …and clicking again does NOT close it — the same interaction opened
    // it. Touch users close via focus loss, pointer-away or Escape.
    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");

    // Moving focus out of the menu item (tap elsewhere) closes the panel.
    // (Tab alone is not enough: with the panel open, the next tab stop is a
    // link INSIDE the same menu item — focus within keeps it open, by
    // design.)
    act(() => {
      screen.getByRole("link", { name: /^Tools/ }).focus();
    });
    expect(button).toHaveAttribute("aria-expanded", "false");
  });
});

describe("mobile navigation", () => {
  it("is collapsed by default", () => {
    render(<MobileNav />);
    const trigger = screen.getByRole("button", { name: /open menu/i });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("navigation", { name: "Mobile" })).not.toBeInTheDocument();
  });

  it("opens the panel with non-category links and category sections", async () => {
    const user = userEvent.setup();
    render(<MobileNav />);

    await user.click(screen.getByRole("button", { name: /open menu/i }));

    const nav = screen.getByRole("navigation", { name: "Mobile" });
    for (const item of NON_CATEGORY_NAV) {
      expect(
        within(nav).getByRole("link", { name: nameStartsWith(item.label) }),
      ).toHaveAttribute("href", item.href);
    }
    for (const { item } of CATEGORY_NAV) {
      expect(
        within(nav).getByRole("button", { name: new RegExp(`^${item.label}`, "i") }),
      ).toHaveAttribute("aria-expanded", "false");
    }
    expect(screen.getByRole("button", { name: /close menu/i })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("tapping a category expands its tools; tapping again collapses", async () => {
    const user = userEvent.setup();
    render(<MobileNav />);
    await user.click(screen.getByRole("button", { name: /open menu/i }));

    const first = CATEGORY_NAV[0];
    await user.click(categoryButton(first.item.label));
    expect(categoryButton(first.item.label)).toHaveAttribute("aria-expanded", "true");

    // The category's available tools are links to their tool pages.
    const nav = screen.getByRole("navigation", { name: "Mobile" });
    for (const tool of getToolsByCategory(first.category.id).filter(isToolUsable)) {
      expect(
        within(nav).getByRole("link", { name: nameStartsWith(tool.name) }),
      ).toHaveAttribute("href", tool.route);
    }
    expect(
      within(nav).getByRole("link", { name: `View all ${first.category.name} tools` }),
    ).toHaveAttribute("href", first.category.route);

    // The shared card rendering applies on mobile too: each tool card
    // carries its (decorative) catalog icon alongside the name.
    const mobileAvailable = getToolsByCategory(first.category.id).filter(isToolUsable);
    for (const tool of mobileAvailable) {
      const link = within(nav).getByRole("link", { name: nameStartsWith(tool.name) });
      expect(link.querySelector("svg")).not.toBeNull();
    }

    await user.click(categoryButton(first.item.label));
    expect(categoryButton(first.item.label)).toHaveAttribute("aria-expanded", "false");
  });

  it("coming-soon tools are listed but never as links", async () => {
    const user = userEvent.setup();
    render(<MobileNav />);
    await user.click(screen.getByRole("button", { name: /open menu/i }));

    const first = CATEGORY_NAV[0];
    await user.click(categoryButton(first.item.label));

    for (const tool of getToolsByCategory(first.category.id)) {
      if (!isToolUsable(tool)) {
        expect(screen.getByText(tool.name).closest("a")).toBeNull();
      }
    }
  });

  it("navigating a tool link closes the menu", async () => {
    const user = userEvent.setup();
    render(<MobileNav />);
    await user.click(screen.getByRole("button", { name: /open menu/i }));

    const first = CATEGORY_NAV[0];
    const available = getToolsByCategory(first.category.id).filter(isToolUsable);
    if (available.length === 0) throw new Error("pick a category with tools");

    await user.click(categoryButton(first.item.label));
    await user.click(
      screen.getByRole("link", { name: nameStartsWith(available[0].name) }),
    );

    expect(screen.queryByRole("navigation", { name: "Mobile" })).not.toBeInTheDocument();
  });

  it("closes with the Escape key", async () => {
    const user = userEvent.setup();
    render(<MobileNav />);

    await user.click(screen.getByRole("button", { name: /open menu/i }));
    expect(screen.getByRole("navigation", { name: "Mobile" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("navigation", { name: "Mobile" })).not.toBeInTheDocument();
  });

  it("closes with the close button", async () => {
    const user = userEvent.setup();
    render(<MobileNav />);

    await user.click(screen.getByRole("button", { name: /open menu/i }));
    await user.click(screen.getByRole("button", { name: /close navigation/i }));

    expect(screen.queryByRole("navigation", { name: "Mobile" })).not.toBeInTheDocument();
  });
});

describe("header category menus — catalog source of truth", () => {
  it("derives its data from the existing catalog (no duplicate tool list)", () => {
    // The dropdown components read getToolsByCategory + primaryNav only;
    // prove the module surface carries no parallel tool definitions.
    const moduleSource = readFileSync(
      join(process.cwd(), "src/components/layout/header-category.tsx"),
      "utf8",
    );
    expect(moduleSource).toContain("getToolsByCategory(category.id)");
    expect(moduleSource).not.toMatch(/name:\s*"(Merge PDF|PDF to Word|Split PDF)"/);
  });

  it("every catalogued tool appears in exactly one category panel", async () => {
    const user = userEvent.setup();
    render(<DesktopNav />);

    const seen: string[] = [];
    for (const { item } of CATEGORY_NAV) {
      await openCategoryPanel(user, item.label);
      for (const link of screen.getAllByRole("link")) {
        const href = link.getAttribute("href");
        if (href?.startsWith("/tools/")) seen.push(href);
      }
      await user.unhover(categoryButton(item.label));
    }

    const expected = CATEGORY_NAV.flatMap(({ category }) =>
      getToolsByCategory(category.id)
        .filter(isToolUsable)
        .map((tool) => tool.route),
    );
    expect(seen.sort()).toEqual([...new Set(expected)].sort());
  });
});
