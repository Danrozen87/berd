import { useLayoutEffect } from "react";
import {
  accessiblePrimary,
  BLACK,
  normalizeHexColor,
  WHITE,
} from "./colorContrast";

// These existing semantic surfaces remain authored in globals.css.
const SURFACES = ["--canvas-base", "--card", "--popover", "--muted"] as const;
const OVERRIDES = [
  "--primary",
  "--primary-foreground",
  "--sidebar-primary",
  "--sidebar-primary-foreground",
] as const;

export function applyPrimaryColor(
  root: HTMLElement,
  seed: string | null,
  theme: "light" | "dark",
): void {
  // Sidebar colors inherit the root pair through CSS, including during HMR
  // from the old provider, which wrote independent inline sidebar overrides.
  root.style.removeProperty("--sidebar-primary");
  root.style.removeProperty("--sidebar-primary-foreground");
  if (!seed) {
    for (const token of OVERRIDES) root.style.removeProperty(token);
    return;
  }
  const style = getComputedStyle(root);
  const surfaces = SURFACES.map((token) =>
    normalizeHexColor(style.getPropertyValue(token)),
  ).filter((color): color is string => color !== null);
  const palette = accessiblePrimary(
    seed,
    theme,
    surfaces.length ? surfaces : [theme === "light" ? WHITE : BLACK],
  );
  root.style.setProperty("--primary", palette.background);
  root.style.setProperty("--primary-foreground", palette.foreground);
}

export function usePrimaryColor(seed: string | null, theme: "light" | "dark") {
  useLayoutEffect(() => {
    applyPrimaryColor(document.documentElement, seed, theme);
  }, [seed, theme]);
}
