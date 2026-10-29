/** Same-origin unless VITE_API_BASE is set (no trailing slash). */
export function apiBase(): string {
  const raw = (import.meta.env.VITE_API_BASE ?? "").trim();
  return raw.replace(/\/$/, "");
}

/**
 * Mock mode serves the sample reports and fake conversations.
 * `?mock=1` turns it on. `?mock=0` turns it off. Otherwise VITE_MOCK=1.
 */
export function isMockMode(): boolean {
  if (typeof window !== "undefined") {
    const flag = new URLSearchParams(window.location.search).get("mock");
    if (flag === "1" || flag === "true") return true;
    if (flag === "0" || flag === "false") return false;
  }
  return import.meta.env.VITE_MOCK === "1";
}

export function queryFlag(name: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}

export type ThemeName = "black" | "white";

export const THEME_KEY = "psychosight-theme";

export function currentTheme(): ThemeName {
  const value = document.documentElement.dataset.theme;
  return value === "white" ? "white" : "black";
}

export function applyTheme(theme: ThemeName): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* private mode */
  }
  const icon = document.getElementById("favicon");
  if (icon instanceof HTMLLinkElement) {
    icon.href = `/logos/${theme}/favicon.svg`;
  }
}
