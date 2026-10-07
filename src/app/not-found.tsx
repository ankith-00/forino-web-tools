import Link from "next/link";
import Navbar from "@/components/layout/Navbar";
import { SiteFooter } from "@/components/layout/SiteFooter";

/**
 * The 404 screen, reached from two places:
 *
 *  - Tool routes that exist in `TOOLS` but have not been built yet. They call
 *    `notFound()` rather than rendering a "coming soon" panel of their own, so the
 *    response is a real 404 and one shared screen covers every future tool — adding
 *    a tool needs no new markup here, only a route that calls `notFound()`.
 *
 *  - Any URL that matches no route at all, which Next routes here by default.
 *
 * Renders inside the root layout, so the theme script and the site branding provider
 * are already in place. That matters for the colours: the framework's own 404
 * ignores the app theme and follows the OS setting instead, which would show a light
 * panel inside the dark UI. Owning the markup avoids that.
 *
 * No card or border — the page is set straight onto the background, so the 404 marks
 * itself at a glance without anything framed around it. No icon either: at this size
 * the numerals are the whole heading, and a glyph above them only competes with it.
 */
export default function NotFound() {
    return (
        <div className="flex min-h-svh flex-col bg-background font-sans text-foreground">
            <Navbar />
            <main className="flex flex-1 items-center justify-center px-6 py-16">
                {/* Capped just to keep the description and the credit on a readable
                    measure. There is no background or border here, so this width
                    governs the text block only, not a panel. */}
                <div className="w-full max-w-md text-center">
                    <p className="font-mono text-8xl font-bold tracking-tight text-foreground sm:text-9xl">
                        404
                    </p>
                    <h1 className="mt-3 text-xl font-semibold">Page not found</h1>
                    <p className="mt-3 text-sm text-muted-foreground">
                        Work in progress:{" "}
                        <a
                            href="https://ankith.is-a.dev"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-blue-600 underline underline-offset-2 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300"
                        >
                            ankith.is-a.dev
                        </a>{" "}
                        is working on it.
                    </p>
                    <Link
                        href="/dashboard"
                        className="mt-6 inline-block text-sm font-medium text-foreground underline underline-offset-2 hover:text-muted-foreground"
                    >
                        Back
                    </Link>
                </div>
            </main>
            <SiteFooter />
        </div>
    );
}