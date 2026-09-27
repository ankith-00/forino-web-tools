import Link from "next/link";
import type { ReactNode } from "react";

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
 */
export function SiteHeader({ children, className = "", logoHref = "/dashboard" }: SiteHeaderProps) {
    return (
        <header className={`border-b border-border bg-background/80 backdrop-blur ${className}`}>
            <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
                <Link href={logoHref} className="font-serif text-xl font-semibold tracking-tight">
                    Forino
                </Link>
                <div className="flex items-center gap-3">{children}</div>
            </nav>
        </header>
    );
}
