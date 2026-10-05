"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useSiteBranding } from "@/components/layout/SiteBrandingProvider";
import { resolveSiteTitle } from "@/lib/site-branding";

type SiteHeaderProps = {
    /** Rendered on the right, vertically centred against the logo. */
    children?: ReactNode;
    /**
     * Positioning only — `sticky` for pages that scroll, `absolute` for the
     * signed-out pages where the header overlays a full-height centred form and
     * must not take up flow space (that would shove the form down by half its
     * height).
     */
    className?: string;
    /**
     * Where the wordmark points. The Navbar sends signed-in users to
     * /dashboard; the auth pages must not, because the proxy bounces anonymous
     * users off /dashboard straight back to /login, making the link a no-op.
     */
    logoHref?: string;
};

/**
 * The site chrome shared by the authenticated Navbar and the signed-out login
 * and register pages.
 *
 * The inner container owns the horizontal rhythm — `mx-auto max-w-6xl px-6` —
 * so the right-hand control (the avatar on the dashboard, the theme toggle on
 * the auth pages) lands at the same offset from the viewport edge on every
 * page. Both callers share this component precisely so those offsets cannot
 * drift apart when the padding is ever tuned.
 *
 * The wordmark is the signed-in user's own title when an admin has set one, and
 * the platform name otherwise. It arrives through `SiteBrandingProvider`, which the
 * root layout fills from a server read, so the correct name is in the
 * server-rendered HTML — fetching it client-side would show the default first and
 * correct it after hydration, which is visible on every page load.
 *
 * `font-mono` is scoped to the wordmark alone, not the header or the body. The font
 * itself needs no setup here: `JetBrains_Mono` is already loaded in the root layout
 * and `globals.css` maps its variable onto Tailwind's `--font-mono`, so this class
 * is all it takes. Tracking is kept tight because JetBrains Mono is monospaced and
 * a looser letter-spacing reads as a gap rather than as emphasis.
 */
export function SiteHeader({ children, className = "", logoHref = "/dashboard" }: SiteHeaderProps) {
    const branding = useSiteBranding();

    return (
        <header className={`border-b border-border bg-background/80 backdrop-blur ${className}`}>
            <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
                <Link href={logoHref} className="font-mono text-xl font-semibold tracking-tight">
                    {resolveSiteTitle(branding)}
                </Link>
                <div className="flex items-center gap-3">{children}</div>
            </nav>
        </header>
    );
}
