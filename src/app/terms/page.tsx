import Link from "next/link";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { ThemeToggle } from "@/components/theme/theme-toggle";

/**
 * Deliberately outside the `(auth)` group: that layout centres its children in
 * a fixed `h-svh` column, which is right for a login form but would clip a
 * long legal document. This page scrolls normally and borrows only the header
 * and footer, so it reads identically to the signed-out pages at the top.
 */
const SECTIONS = [
    {
        title: "Acceptance of these terms",
        body: "By creating an account or using Forino you agree to these terms in full. If you do not agree with any part of them you must not use the service.",
    },
    {
        title: "Who may use Forino",
        body: "Accounts are issued to staff, invigilators and administrators by your institution. Forino is not available to the general public, and credentials may not be shared, resold or passed to another person. You are responsible for everything done under your account.",
    },
    {
        title: "Permitted use",
        body: "Forino exists to help authorised staff run examinations and record attendance. You agree to use it only for that purpose, and only through the interface provided. Reverse engineering, probing for vulnerabilities, scraping, or attempting to access data belonging to other users or institutions is prohibited.",
    },
    {
        title: "Scanning and recorded data",
        body: "Barcode, page and attendance data captured through the scanning tools is uploaded to our infrastructure and processed on your institution's behalf. Do not use the scanning tools to capture, retain or distribute material you are not authorised to handle.",
    },
    {
        title: "Availability and changes",
        body: "We aim to keep Forino available during examination periods but do not guarantee uninterrupted service. Features may be added, changed or withdrawn. We may suspend or terminate access where we reasonably believe these terms have been breached or the service is being misused.",
    },
    {
        title: "Intellectual property",
        body: "The Forino name, interface, source design and underlying software remain our property. These terms grant you a limited right to use the service as intended, and no other rights in it.",
    },
    {
        title: "Limitation of liability",
        body: "To the fullest extent permitted by law, Forino is provided as is, without warranties of any kind. We are not liable for indirect or consequential loss, including loss of examination or attendance records, arising from use of or inability to use the service. Nothing here limits liability that cannot lawfully be limited.",
    },
    {
        title: "Changes to these terms",
        body: "We may update these terms. Material changes will be announced in the application before they take effect, and continuing to use Forino after that point means you accept the revised terms.",
    },
    {
        title: "Contact",
        body: "Questions about these terms, or a request to correct the data held about you, should be raised with your institution's Forino administrator in the first instance.",
    },
];

export default function TermsPage() {
    return (
        <div className="flex min-h-svh flex-col bg-background font-sans text-foreground">
            {/* Sticky rather than absolute: this page scrolls, so the header
                belongs in flow. The logo points at / so a signed-out reader
                lands on login instead of being bounced off /dashboard.
                ThemeToggle is a client component, so rendering it as a child
                of this server component is fine and keeps the toggle in the
                same right-hand slot as login and register. */}
            <SiteHeader className="sticky top-0 z-50" logoHref="/">
                <ThemeToggle />
            </SiteHeader>

            <main className="mx-auto w-full max-w-3xl flex-1 px-6 pb-10 pt-10">
                <h1 className="text-3xl font-bold tracking-tight">Terms &amp; Conditions</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    Last updated 28 September 2026. These terms govern your use of Forino.
                </p>

                <ol className="mt-8 flex flex-col gap-6">
                    {SECTIONS.map((section, i) => (
                        <li key={section.title} className="flex gap-4">
                            <span
                                aria-hidden
                                className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-card text-xs font-semibold text-muted-foreground"
                            >
                                {i + 1}
                            </span>
                            <div className="min-w-0">
                                <h2 className="text-base font-semibold">{section.title}</h2>
                                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                                    {section.body}
                                </p>
                            </div>
                        </li>
                    ))}
                </ol>

                <p className="mt-10 text-sm text-muted-foreground">
                    Already have an account?{" "}
                    <Link href="/login" className="text-primary underline underline-offset-2">
                        Log in
                    </Link>{" "}
                    or{" "}
                    <Link href="/register" className="text-primary underline underline-offset-2">
                        create one
                    </Link>
                    .
                </p>
            </main>

            <SiteFooter />
        </div>
    );
}
