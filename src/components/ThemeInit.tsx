"use client";

import { useEffect } from "react";

export function ThemeInit() {
    useEffect(() => {
        try {
            const s = localStorage.getItem("forino-theme");
            const d = s ? s === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
            document.documentElement.classList.toggle("dark", d);
        } catch (e) {
            // no-op
        }
    }, []);
    return null;
}