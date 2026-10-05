"use client";

import { createContext, useCallback, useContext, useEffect, useSyncExternalStore, useState } from "react";

type Theme = "light" | "dark" | "system";

type ThemeProviderProps = {
    children: React.ReactNode;
    defaultTheme?: Theme;
    storageKey?: string;
};

type ThemeProviderState = {
    theme: Theme;
    resolvedTheme: "light" | "dark";
    setTheme: (theme: Theme) => void;
};

const ThemeProviderContext = createContext<ThemeProviderState | undefined>(undefined);

const getSystemTheme = (): "light" | "dark" =>
    typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";

const subscribeSystemTheme = (callback: () => void) => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", callback);
    return () => media.removeEventListener("change", callback);
};

export function ThemeProvider({
    children,
    defaultTheme = "system",
    // Must match the key read by the inline theme-init script in `src/app/layout.tsx`,
  // which paints the theme before hydration to avoid a flash of the wrong one.
  storageKey = "util-hub-theme",
}: ThemeProviderProps) {
    const [theme, setThemeState] = useState<Theme>(() => {
        if (typeof window === "undefined") return defaultTheme;
        return (window.localStorage.getItem(storageKey) as Theme | null) ?? defaultTheme;
    });

    const systemTheme = useSyncExternalStore<"light" | "dark">(
        subscribeSystemTheme,
        getSystemTheme,
        () => "light"
    );

    useEffect(() => {
        const root = document.documentElement;
        root.classList.remove("light", "dark");
        root.classList.add(theme === "system" ? systemTheme : theme);
    }, [theme, systemTheme]);

    const setTheme = useCallback(
        (nextTheme: Theme) => {
            setThemeState(nextTheme);
            window.localStorage.setItem(storageKey, nextTheme);
        },
        [storageKey]
    );

    const resolvedTheme = theme === "system" ? systemTheme : theme;

    return (
        <ThemeProviderContext.Provider value={{ theme, resolvedTheme, setTheme }}>
            {children}
        </ThemeProviderContext.Provider>
    );
}

export function useTheme() {
    const context = useContext(ThemeProviderContext);
    if (!context) {
        throw new Error("useTheme must be used within a ThemeProvider");
    }
    return context;
}