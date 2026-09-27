"use client";

import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";

/**
 * Shared chrome for the signed-out pages (login, register).
 *
 * `(auth)` is a route group, so this adds no URL segment: `/login` and
 * `/register` are unaffected. The group's only files are UI — every
 * `route.ts` in this project lives under `src/app/api/`.
 *
 * Header and footer are both absolutely positioned so the form stays optically
 * centred in the viewport regardless of how tall either band is. The padding on
 * this wrapper reserves their space, so on a short screen the form is squeezed
 * into the gap between them rather than sliding underneath.
 *
 * The padding is stepped down below `sm` (640px). A phone is roughly 375px
 * wide, and the previous fixed `px-4` + the card's `p-8` ate 48px off each side,
 * leaving the inputs only ~279px of a 375px screen. Tighter values on mobile
 * hand that space back to the fields while leaving every larger viewport
 * exactly as it was.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
    return (
        <div className="relative flex h-svh w-full flex-col items-center justify-center bg-background px-3 pb-16 pt-20 font-sans text-foreground sm:px-4 sm:pb-20 sm:pt-24">
            <SiteHeader className="absolute inset-x-0 top-0 z-50" logoHref="/">
                <ThemeToggle />
            </SiteHeader>
            {children}
            <SiteFooter className="absolute inset-x-0 bottom-0 z-10" />
        </div>
    );
}
