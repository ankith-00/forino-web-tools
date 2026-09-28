import type { ReactNode } from "react";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { resolvePendingInvite } from "@/lib/invites";
import AcceptInviteForm from "./accept-invite-form";

/** Same chrome and padding steps as the (auth) group, without its redirect. */
function Shell({ children }: { children: ReactNode }) {
    return (
        <div className="relative flex min-h-svh w-full flex-col items-center justify-center bg-background px-3 pb-16 pt-20 font-sans text-foreground sm:px-4 sm:pb-20 sm:pt-24">
            <SiteHeader className="absolute inset-x-0 top-0 z-50" logoHref="/">
                <ThemeToggle />
            </SiteHeader>
            {children}
            <SiteFooter className="absolute inset-x-0 bottom-0 z-10" />
        </div>
    );
}

const COPY: Record<string, { title: string; body: string }> = {
    missing: {
        title: "This link is incomplete",
        body: "Open the link straight from your invitation email. If it still doesn't work, ask whoever invited you to send a new one.",
    },
    invalid: {
        title: "This invitation isn't valid",
        body: "It may have been mistyped or already replaced. Ask whoever invited you to send a new one.",
    },
    expired: {
        title: "This invitation has expired",
        body: "Invitations last 7 days. Ask whoever invited you to send a fresh link — it only takes a moment.",
    },
    used: {
        title: "This invitation has already been used",
        body: "If that was you, your account is ready. Sign in with the password you chose.",
    },
    revoked: {
        title: "This invitation was withdrawn",
        body: "It was cancelled or replaced by a newer one. Ask whoever invited you to send another.",
    },
    unavailable: {
        title: "We couldn't check that invitation",
        body: "Something went wrong on our side. Try again in a moment, or ask whoever invited you to send a new link.",
    },
};

function Problem({ reason }: { reason: string }) {
    const copy = COPY[reason] ?? COPY.invalid;
    return (
        <div className="flex w-full max-w-md flex-col gap-4 rounded-[0.8em] border border-border bg-card p-5 text-center shadow-sm sm:p-8">
            <h1 className="text-xl font-semibold">{copy.title}</h1>
            <p className="text-sm text-muted-foreground">{copy.body}</p>
            <a
                href="/login"
                className="mx-auto mt-2 cursor-pointer rounded-[0.8em] bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
                Go to login
            </a>
        </div>
    );
}

/**
 * Landing page for an admin invitation.
 *
 * Public by necessity — the invitee has no account yet, so the proxy leaves this
 * path alone and the emailed token is the only gate. It is re-validated server
 * side on submit; the lookup here exists so the form is shown instead of an
 * error, and so a spent link explains itself rather than failing on POST.
 *
 * Somebody already signed in has nothing to do here, but they can still open the
 * link (a shared laptop, a forwarded mail). createUser would reject the address
 * anyway, and the accept action turns that into a "sign in instead" message, so
 * there is no need to bounce them here.
 */
export default async function AcceptInvitePage({
    searchParams,
}: {
    searchParams: Promise<{ token?: string | string[] }>;
}) {
    const { token } = await searchParams;
    const raw = Array.isArray(token) ? token[0] : token;

    if (!raw) {
        return (
            <Shell>
                <Problem reason="missing" />
            </Shell>
        );
    }

    // The lookup is the one thing on this page that touches the database, and it
    // is unauthenticated, so a missing migration or a connection blip must not
    // surface as a 500 to somebody who just followed a link from their inbox.
    let lookup;
    try {
        lookup = await resolvePendingInvite(raw);
    } catch (e) {
        console.error("[invite/accept] lookup failed:", e);
        lookup = { ok: false, reason: "unavailable" } as const;
    }
    if (!lookup.ok) {
        return (
            <Shell>
                <Problem reason={lookup.reason} />
            </Shell>
        );
    }

    const { displayName } = lookup.invite;

    return (
        <Shell>
            <AcceptInviteForm token={raw} displayName={displayName} />
        </Shell>
    );
}
