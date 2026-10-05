"use client";

import Link from "next/link";
import { useSiteBranding } from "@/components/layout/SiteBrandingProvider";
import { AUTHOR_URL, usesDefaultFooter } from "@/lib/site-branding";

/**
 * The site footer, shared by the dashboard, manage-users, the signed-out pages
 * and the legal pages. It was previously copy-pasted into each page, so the
 * credit line and its link had to be edited in several places at once.
 *
 * Two distinct footers, and the split is deliberate:
 *
 *  - The default credit line renders "ANKITH" as a real link to ankith.dev, with
 *    the heart written as a code-point escape on purpose. U+1F496 lives above the
 *    BMP, so it cannot be written with a 4-digit \uXXXX escape (that form tops out
 *    at U+FFFF); `{"\u{1F496}"}` is the only escape that addresses it, and it
 *    sidesteps the surrogate pair getting split or mangled by tooling that
 *    re-encodes the file. PowerShell's console renders the original literal as
 *    "??", which is how the wrong character nearly survived review — compare code
 *    points, not rendered output, when checking this.
 *
 *  - A footer an admin has set for this user replaces that line entirely and is
 *    rendered as inert plain text, with no link and no heart. Admin-authored text
 *    must not be silently decorated with someone else's name and URL, and free
 *    text must not be able to become a link for whoever types it next.
 *
 * Left in normal flow by default, which parks it at the end of the content on
 * long pages and at the bottom of the viewport on short ones. Pages that centre
 * their content in a fixed-height column pass `absolute inset-x-0 bottom-0`
 * instead, so the footer does not steal vertical space from that content.
 */
export function SiteFooter({ className = "" }: { className?: string }) {
    const branding = useSiteBranding();

    return (
        <footer className={`py-4 text-center text-xs text-muted-foreground ${className}`}>
            {usesDefaultFooter(branding) ? (
                <>
                    MADE WITH {"\u{1F496}"} BY :{" "}
                    <Link
                        href={AUTHOR_URL}
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold text-blue-500 underline"
                    >
                        ANKITH
                    </Link>
                </>
            ) : (
                branding.footerNote
            )}
        </footer>
    );
}