import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { createElement, type AnchorHTMLAttributes } from "react";
import { afterEach, vi } from "vitest";
import { resetThemeCache } from "@/lib/theme";

/* -------------------------------------------------------------------------- */
/* Next.js mocks                                                              */
/* -------------------------------------------------------------------------- */
// `next/link` needs the App Router context, which does not exist in jsdom, so
// it is replaced with a plain anchor for component tests.
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) =>
    createElement("a", { href, ...props }, children),
}));

export const routerMock = {
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  prefetch: vi.fn(),
};

export const pathnameMock = { current: "/" };

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
  usePathname: () => pathnameMock.current,
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

/* -------------------------------------------------------------------------- */
/* Browser APIs missing from jsdom                                            */
/* -------------------------------------------------------------------------- */
if (!window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  resetThemeCache();
  document.documentElement.className = "";
  delete document.documentElement.dataset.theme;
  routerMock.push.mockClear();
  routerMock.replace.mockClear();
  pathnameMock.current = "/";
});
