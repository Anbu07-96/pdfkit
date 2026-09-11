import { render, screen, within, fireEvent, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DesktopNav } from "@/components/layout/desktop-nav";
import { MobileNav } from "@/components/layout/mobile-nav";
import { getNavMenuEntries } from "@/components/layout/header-category";
import { primaryNav } from "@/lib/config/site";
import {
  TOOL_CATEGORIES,
  getTool,
  getToolsByCategory,
  isToolUsable,
} from "@/lib/tools";
import {
  BULK_OPERATIONS,
  BULK_UNAVAILABLE_CONVERSIONS,
} from "@/lib/tools/bulk";

/** The primary-nav entries that are categories (dropdown targets). */
const CATEGORY_NAV = primaryNav.flatMap((item) => {
  const category = TOOL_CATEGORIES.find((c) => c.route === item.href);
  return category ? [{ item, category }] : [];
});
/** Every primary-nav entry that carries a mega-menu: the categories above
 *  plus the bulk registry (Phase 75D.3), in primaryNav order. */
const MENU_NAV = primaryNav.flatMap((item) => {
  const entry = getNavMenuEntries().find(
    (candidate) => candidate.route === item.href,
  );
  return entry ? [{ item, entry }] : [];
});
const NON_CATEGORY_NAV = primaryNav.filter(
  (item) => !MENU_NAV.some((menu) => menu.item.href === item.href),
);
/** The bulk registry's usable operations — availability is derived from the
 *  underlying single-file catalog tool, exactly like the component does. */
const BULK_AVAILABLE = BULK_OPERATIONS.filter((operation) => {
  const tool = getTool(operation.id);
  return tool ? isToolUsable(tool) : false;
});

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

  it("renders every menu entry — categories and Bulk — as a dropdown trigger", () => {
    render(<DesktopNav />);
    for (const { item } of MENU_NAV) {
      expect(
        screen.getByRole("button", { name: new RegExp(`^${item.label}`, "i") }),
      ).toHaveAttribute("aria-expanded", "false");
    }
    // Bulk flows through the same menu system: one extra trigger, same behavior.
    expect(MENU_NAV.length).toBe(CATEGORY_NAV.length + 1);
    // No panel is open by default.
    expect(screen.queryByRole("link", { name: /view all/i })).not.toBeInTheDocument();
  });

  it("Bulk opens on hover and shows its registry-derived panel", async () => {
    if (BULK_AVAILABLE.length === 0) throw new Error("bulk registry unexpectedly empty");
    const user = userEvent.setup();
    render(<DesktopNav />);
    await openCategoryPanel(user, "Bulk");

    expect(categoryButton("Bulk")).toHaveAttribute("aria-expanded", "true");
    const panel = document.getElementById("nav-panel-bulk")!;
    // Heading, description and count all come from existing data: the bulk
    // landing page's title, the primary-nav description, the registry count.
    expect(within(panel).getByText("Bulk tools")).toBeInTheDocument();
    expect(within(panel).getByText("Convert many files at once")).toBeInTheDocument();
    expect(
      within(panel).getByText(
        `${BULK_AVAILABLE.length} ${BULK_AVAILABLE.length === 1 ? "tool" : "tools"} available`,
      ),
    ).toBeInTheDocument();
    expect(
      within(panel).getByRole("link", { name: "View all Bulk tools" }),
    ).toHaveAttribute("href", "/bulk");
  });

  it("Bulk panel lists exactly the bulk registry — available links, coming-soon chips", async () => {
    const user = userEvent.setup();
    render(<DesktopNav />);
    await openCategoryPanel(user, "Bulk");
    const panel = document.getElementById("nav-panel-bulk")!;

    // Every usable bulk operation is a link to its existing bulk page —
    // and nothing else links into /bulk/.
    const bulkLinks = screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("href")?.startsWith("/bulk/"));
    expect(bulkLinks.map((link) => link.getAttribute("href"))).toEqual(
      BULK_AVAILABLE.map((operation) => operation.route),
    );
    for (const operation of BULK_AVAILABLE) {
      const link = within(panel).getByRole("link", {
        name: nameStartsWith(operation.name),
      });
      expect(within(link).getByText(operation.name)).toBeInTheDocument();
      expect(within(link).getByText(operation.description)).toBeInTheDocument();
      // Existing registry icon, rendered decoratively.
      expect(link.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    }

    // The conversions the bulk registry lists as unavailable are honest
    // chips: present, dashed, never interactive.
    for (const conversion of BULK_UNAVAILABLE_CONVERSIONS) {
      const chip = within(panel).getByText(conversion.name);
      expect(chip.closest("a")).toBeNull();
      expect(chip.closest("button")).toBeNull();
      expect(chip.closest("li")?.className).toContain("border-dashed");
    }
  });

  it("switching between Convert, Edit and Bulk swaps content without re-animating the box", async () => {
    const user = userEvent.setup();
    render(<DesktopNav />);

    await openCategoryPanel(user, "Convert");
    expect(document.getElementById("nav-panel-convert")?.className).toContain(
      "nav-panel-in",
    );

    // Straight hover hops between categories and Bulk keep the shared box
    // in place — only the content cross-fades.
    await openCategoryPanel(user, "Edit");
    const editBox = document.getElementById("nav-panel-edit")!;
    expect(editBox.className).not.toContain("nav-panel-in");
    expect(editBox.querySelector(".nav-panel-content-in")).not.toBeNull();

    await openCategoryPanel(user, "Bulk");
    const bulkBox = document.getElementById("nav-panel-bulk")!;
    expect(bulkBox.className).not.toContain("nav-panel-in");
    expect(bulkBox.querySelector(".nav-panel-content-in")).not.toBeNull();

    // …and back to a category, still smooth.
    await openCategoryPanel(user, "Convert");
    const convertBox = document.getElementById("nav-panel-convert")!;
    expect(convertBox.className).not.toContain("nav-panel-in");
  });

  it("keyboard: arrows reach the Bulk menu, Tab enters its panel, arrows wrap", async () => {
    const user = userEvent.setup();
    render(<DesktopNav />);

    // Focus the last category (AI)…
    const ai = CATEGORY_NAV[CATEGORY_NAV.length - 1];
    act(() => {
      categoryButton(ai.item.label).focus();
    });
    expect(categoryButton(ai.item.label)).toHaveAttribute("aria-expanded", "true");

    // …ArrowRight lands on Bulk (the next entry in primaryNav order)…
    await user.keyboard("{ArrowRight}");
    const bulk = categoryButton("Bulk");
    expect(bulk).toHaveFocus();
    expect(bulk).toHaveAttribute("aria-expanded", "true");

    // …Tab moves into the open Bulk panel's links (bulk pages, not a trap).
    await user.tab();
    expect((document.activeElement as HTMLAnchorElement).getAttribute("href")).toMatch(
      /^\/bulk\//,
    );

    // Escape closes and keeps focus on the trigger…
    act(() => {
      bulk.focus();
    });
    await user.keyboard("{Escape}");
    expect(bulk).toHaveAttribute("aria-expanded", "false");
    expect(bulk).toHaveFocus();

    // …and ArrowRight from the last entry wraps to the first (Convert).
    await user.keyboard("{ArrowRight}");
    expect(categoryButton("Convert")).toHaveFocus();
    expect(categoryButton("Convert")).toHaveAttribute("aria-expanded", "true");
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
    // The heading carries the category's own (decorative) catalog icon.
    const headingIcon = panel.querySelector("svg");
    expect(headingIcon?.getAttribute("aria-hidden")).toBe("true");
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
      // Hierarchy inside the tile: decorative icon + name + description.
      expect(within(link).getByText(tool.name)).toBeInTheDocument();
      expect(within(link).getByText(tool.description)).toBeInTheDocument();
      const svgs = link.querySelectorAll("svg");
      expect(svgs[0].getAttribute("aria-hidden")).toBe("true");
      // Interactive target stays comfortably tappable.
      expect(link.className).toContain("min-h-11");
      // Premium tile motion: hover lift + surface transition, disabled
      // under prefers-reduced-motion (global rule + explicit guard).
      expect(link.className).toContain("hover:-translate-y-0.5");
      expect(link.className).toContain("hover:shadow-xs");
      expect(link.className).toContain("motion-reduce:transform-none");
      // The icon chip scales very subtly on hover, also guarded.
      const iconChip = link.querySelector("span");
      expect(iconChip?.className).toContain("group-hover:scale-105");
      expect(iconChip?.className).toContain("motion-reduce:transform-none");
      // Directional cue: a second decorative svg, invisible until hover
      // or keyboard focus.
      expect(svgs.length).toBe(2);
      expect(svgs[1].getAttribute("aria-hidden")).toBe("true");
      expect(svgs[1].getAttribute("class")).toContain("opacity-0");
      expect(svgs[1].getAttribute("class")).toContain("group-focus-visible:opacity-100");
    }
  });

  it("balances an odd number of tiles with a full-width final tile", async () => {
    const odd = CATEGORY_NAV.find(
      ({ category }) =>
        getToolsByCategory(category.id).filter(isToolUsable).length % 2 === 1,
    );
    // No odd category in the catalog today: nothing to balance.
    if (!odd) return;

    const user = userEvent.setup();
    render(<DesktopNav />);
    await openCategoryPanel(user, odd.item.label);

    const panel = document.getElementById(`nav-panel-${odd.category.id}`)!;
    const grid = panel.querySelector("ul")!;
    const tiles = Array.from(grid.children);
    const available = getToolsByCategory(odd.category.id).filter(isToolUsable);
    expect(tiles.length).toBe(available.length);
    // The last tile spans the grid so no half-empty row remains…
    expect(tiles[tiles.length - 1].className).toContain("sm:col-span-2");
    // …and only the last one does.
    for (const tile of tiles.slice(0, -1)) {
      expect(tile.className).not.toContain("col-span-2");
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
    for (const { item } of MENU_NAV) {
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

  it("Bulk accordion lists the bulk registry; navigation closes the menu", async () => {
    if (BULK_AVAILABLE.length === 0) throw new Error("bulk registry unexpectedly empty");
    const user = userEvent.setup();
    render(<MobileNav />);
    await user.click(screen.getByRole("button", { name: /open menu/i }));

    await user.click(categoryButton("Bulk"));
    expect(categoryButton("Bulk")).toHaveAttribute("aria-expanded", "true");

    const nav = screen.getByRole("navigation", { name: "Mobile" });
    for (const operation of BULK_AVAILABLE) {
      expect(
        within(nav).getByRole("link", { name: nameStartsWith(operation.name) }),
      ).toHaveAttribute("href", operation.route);
    }
    expect(
      within(nav).getByRole("link", { name: "View all Bulk tools" }),
    ).toHaveAttribute("href", "/bulk");
    // Unavailable bulk conversions stay non-interactive chips.
    for (const conversion of BULK_UNAVAILABLE_CONVERSIONS) {
      expect(within(nav).getByText(conversion.name).closest("a")).toBeNull();
    }

    // Navigating a bulk tool link closes the menu.
    await user.click(
      within(nav).getByRole("link", { name: nameStartsWith(BULK_AVAILABLE[0].name) }),
    );
    expect(screen.queryByRole("navigation", { name: "Mobile" })).not.toBeInTheDocument();
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
    // The Bulk menu is derived from the existing bulk registry the same way —
    // no duplicated bulk tool list either.
    expect(moduleSource).toContain("BULK_OPERATIONS");
    expect(moduleSource).not.toMatch(
      /Bulk (PDF to Word|Word to PDF|PDF to Excel|Extract Images|Images to PDF)/,
    );
  });

  it("every catalogued tool appears in exactly one category panel", async () => {
    const user = userEvent.setup();
    render(<DesktopNav />);

    const seen: string[] = [];
    // Every menu entry incl. Bulk: the bulk panel links to /bulk/ pages,
    // so it must contribute no /tools/ links to this check.
    for (const { item } of MENU_NAV) {
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
