import * as React from "react";
import { normalizeHexColor } from "./colorContrast";
import { usePrimaryColor } from "./primaryColor";

type ThemeMode = "system" | "light" | "dark";

type ThemeProviderProps = {
  children: React.ReactNode;
};

type ThemeProviderState = {
  themeMode: ThemeMode;
  resolvedTheme: "light" | "dark";
  isDark: boolean;
  isLoading: boolean;
  setThemeMode: (themeMode: ThemeMode) => void;
  primaryColor: string;
  themePrimaryColor: string;
  customPrimaryColor: string | null;
  setPrimaryColor: (color: string) => void;
  resetPrimaryColor: () => void;
};

const THEME_MODE_STORAGE_KEY = "goose-theme-mode";
const PRIMARY_COLOR_STORAGE_KEY = "goose-primary-color";
const DEPRECATED_DENSITY_STORAGE_KEY = "goose-density";
const LEGACY_THEME_CACHE_STORAGE_KEY = "goose-theme-cache-v3";
const LIGHT_THEME_PRIMARY = "#1a1a1a";
const DARK_THEME_PRIMARY = "#ffffff";

const THEME_MODES = ["system", "light", "dark"] as const;

const ThemeProviderContext = React.createContext<
  ThemeProviderState | undefined
>(undefined);

function isThemeMode(value: string | null): value is ThemeMode {
  return THEME_MODES.includes(value as ThemeMode);
}

function readSystemThemePreference() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function getResolvedMode(
  themeMode: ThemeMode,
  systemPrefersDark: boolean,
): "light" | "dark" {
  if (themeMode === "light" || themeMode === "dark") {
    return themeMode;
  }

  return systemPrefersDark ? "dark" : "light";
}

function applyResolvedMode(isDark: boolean) {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(isDark ? "dark" : "light");
  root.style.colorScheme = isDark ? "dark" : "light";
}

function readInitialThemeMode(): ThemeMode {
  const storedThemeMode = window.localStorage.getItem(THEME_MODE_STORAGE_KEY);

  if (isThemeMode(storedThemeMode)) {
    return storedThemeMode;
  }

  return "system";
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [themeMode, setThemeModeState] =
    React.useState<ThemeMode>(readInitialThemeMode);
  const [systemPrefersDark, setSystemPrefersDark] = React.useState(
    readSystemThemePreference,
  );
  const [customPrimaryColor, setCustomPrimaryColor] = React.useState<
    string | null
  >(() =>
    normalizeHexColor(window.localStorage.getItem(PRIMARY_COLOR_STORAGE_KEY)),
  );

  const resolvedTheme = getResolvedMode(themeMode, systemPrefersDark);
  const isDark = resolvedTheme === "dark";
  const themePrimaryColor = isDark ? DARK_THEME_PRIMARY : LIGHT_THEME_PRIMARY;
  const primaryColor = customPrimaryColor ?? themePrimaryColor;

  React.useEffect(() => {
    window.localStorage.removeItem(LEGACY_THEME_CACHE_STORAGE_KEY);
    window.localStorage.removeItem(DEPRECATED_DENSITY_STORAGE_KEY);
    window.document.documentElement.removeAttribute("data-density");
  }, []);

  React.useLayoutEffect(() => {
    applyResolvedMode(isDark);
  }, [isDark]);

  usePrimaryColor(customPrimaryColor, resolvedTheme);

  React.useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => {
      setSystemPrefersDark(event.matches);
    };

    setSystemPrefersDark(mediaQuery.matches);
    mediaQuery.addEventListener("change", onChange);
    return () => mediaQuery.removeEventListener("change", onChange);
  }, []);

  React.useEffect(() => {
    window.localStorage.setItem(THEME_MODE_STORAGE_KEY, themeMode);
  }, [themeMode]);

  React.useEffect(() => {
    if (customPrimaryColor) {
      window.localStorage.setItem(
        PRIMARY_COLOR_STORAGE_KEY,
        customPrimaryColor,
      );
    } else {
      window.localStorage.removeItem(PRIMARY_COLOR_STORAGE_KEY);
    }
  }, [customPrimaryColor]);

  const setThemeMode = React.useCallback((nextThemeMode: ThemeMode) => {
    setThemeModeState(nextThemeMode);
  }, []);

  const setPrimaryColor = React.useCallback((color: string) => {
    const normalizedColor = normalizeHexColor(color);
    if (normalizedColor) {
      setCustomPrimaryColor(normalizedColor);
    }
  }, []);

  const resetPrimaryColor = React.useCallback(() => {
    setCustomPrimaryColor(null);
  }, []);

  const value = React.useMemo(
    () => ({
      themeMode,
      resolvedTheme,
      isDark,
      isLoading: false,
      setThemeMode,
      primaryColor,
      themePrimaryColor,
      customPrimaryColor,
      setPrimaryColor,
      resetPrimaryColor,
    }),
    [
      customPrimaryColor,
      isDark,
      primaryColor,
      resetPrimaryColor,
      resolvedTheme,
      setPrimaryColor,
      setThemeMode,
      themePrimaryColor,
      themeMode,
    ],
  );

  return (
    <ThemeProviderContext.Provider value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export function useTheme() {
  const context = React.useContext(ThemeProviderContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
