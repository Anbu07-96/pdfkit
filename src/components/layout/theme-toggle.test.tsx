import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { THEME_STORAGE_KEY } from "@/lib/theme";

function renderToggle() {
  return render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  );
}

describe("theme switching", () => {
  it("defaults to the system preference when nothing is stored", async () => {
    renderToggle();
    expect(
      await screen.findByRole("button", { name: /theme: system/i }),
    ).toBeInTheDocument();
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it("applies and persists the dark theme", async () => {
    const user = userEvent.setup();
    renderToggle();

    await user.click(await screen.findByRole("button", { name: /change theme/i }));
    await user.click(screen.getByRole("menuitemradio", { name: /dark/i }));

    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("switches back to light and marks the active option", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    renderToggle();

    await user.click(await screen.findByRole("button", { name: /change theme/i }));
    await user.click(screen.getByRole("menuitemradio", { name: /light/i }));

    expect(document.documentElement).not.toHaveClass("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");

    await user.click(screen.getByRole("button", { name: /change theme/i }));
    expect(screen.getByRole("menuitemradio", { name: /light/i })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("closes the menu with Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    renderToggle();

    const trigger = await screen.findByRole("button", { name: /change theme/i });
    await user.click(trigger);
    expect(screen.getByRole("menu")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
