import "@testing-library/jest-dom/vitest";
import { createElement, type AnchorHTMLAttributes } from "react";
import { afterEach, vi } from "vitest";
import { resetThemeCache } from "@/lib/theme";

/**
 * Shared test setup.
 *
 * Component tests run in jsdom; processing, validation and API-route tests opt
 * into Node with `// @vitest-environment node`. Everything DOM-specific below
 * is therefore guarded.
 */
const isDom = typeof window !== "undefined";

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
if (isDom && !window.matchMedia) {
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

if (isDom && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
}

// jsdom does not implement object URLs, which the download flow relies on.
if (isDom && !URL.createObjectURL) {
  let counter = 0;
  URL.createObjectURL = vi.fn(() => `blob:pdfkit/${++counter}`);
  URL.revokeObjectURL = vi.fn();
}

afterEach(async () => {
  if (isDom) {
    const { cleanup } = await import("@testing-library/react");
    cleanup();
    window.localStorage.clear();
    document.documentElement.className = "";
    delete document.documentElement.dataset.theme;
  }
  resetThemeCache();
  routerMock.push.mockClear();
  routerMock.replace.mockClear();
  pathnameMock.current = "/";
});
