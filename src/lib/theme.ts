/**
 * Theme store.
 *
 * The preference lives in `localStorage` — an external store — so it is exposed
 * through a subscribe/snapshot pair for `useSyncExternalStore`. That keeps the
 * React tree in sync with storage (and with the OS setting) without effects
 * that write state during render.
 */

export const THEME_STORAGE_KEY = "pdfkit-theme";

export const THEMES = ["light", "dark", "system"] as const;

export type Theme = (typeof THEMES)[number];
export type ResolvedTheme = "light" | "dark";

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

function readStoredTheme(): Theme {
  if (typeof window === "undefined") return "system";
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(stored) ? stored : "system";
  } catch {
    // Private mode or blocked storage: fall back to the system preference.
    return "system";
  }
}

/* -------------------------------------------------------------------------- */
/* Preference store                                                           */
/* -------------------------------------------------------------------------- */

let cachedTheme: Theme | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

export function subscribeToTheme(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY) {
      cachedTheme = null;
      emit();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Clears the cached snapshot. Used by storage events and by tests. */
export function resetThemeCache(): void {
  cachedTheme = null;
}

/** Snapshot must be referentially stable, hence the cache. */
export function getThemeSnapshot(): Theme {
  cachedTheme ??= readStoredTheme();
  return cachedTheme;
}

/** No storage on the server: always start from the system preference. */
export function getServerThemeSnapshot(): Theme {
  return "system";
}

export function setStoredTheme(theme: Theme): void {
  cachedTheme = theme;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* ignore write failures */
  }
  emit();
}

/* -------------------------------------------------------------------------- */
/* System preference store                                                    */
/* -------------------------------------------------------------------------- */

function darkMediaQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || !window.matchMedia) return null;
  return window.matchMedia("(prefers-color-scheme: dark)");
}

export function subscribeToSystemTheme(listener: () => void): () => void {
  const media = darkMediaQuery();
  media?.addEventListener("change", listener);
  return () => media?.removeEventListener("change", listener);
}

export function getSystemTheme(): ResolvedTheme {
  return darkMediaQuery()?.matches ? "dark" : "light";
}

export function getServerSystemTheme(): ResolvedTheme {
  return "light";
}

export function resolveTheme(theme: Theme, systemTheme: ResolvedTheme): ResolvedTheme {
  return theme === "system" ? systemTheme : theme;
}

/* -------------------------------------------------------------------------- */
/* DOM                                                                        */
/* -------------------------------------------------------------------------- */

/** Apply the resolved theme to `<html>`. */
export function applyTheme(resolved: ResolvedTheme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
}

/**
 * Script injected before first paint so the stored theme is applied without a
 * flash. Kept as a string because it must run synchronously in <head>.
 */
export const themeInitScript = `(function(){try{var k=${JSON.stringify(
  THEME_STORAGE_KEY,
)};var s=localStorage.getItem(k);var m=window.matchMedia("(prefers-color-scheme: dark)").matches;var d=s==="dark"||((s==="system"||!s)&&m);var r=document.documentElement;r.classList.toggle("dark",d);r.dataset.theme=d?"dark":"light";r.style.colorScheme=d?"dark":"light";}catch(e){}})();`;
