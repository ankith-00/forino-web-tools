"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { HiOutlineXCircle } from "react-icons/hi";
import { revokeUserInvite } from "./actions";
import type { Invite, InviteState } from "@/lib/invite-shared";
import { inviteMatchesQuery, inviteState, isWithdrawable } from "@/lib/invite-shared";
import { initials } from "@/lib/initials";

/**
 * The "Invites sent" tab: every invitation ever issued, newest first, with what
 * became of it. Kept out of users-table.tsx because that file is already large
 * and this is a different entity with different columns.
 *
 * Status is carried by the card's own colour rather than a pill, mirroring how
 * a banned user reads at a glance in the Banned tab: a live invitation is
 * yellow, a withdrawn one is violet, and a spent/joined one stays neutral. The
 * Withdraw button stays in the pending yellow so the two match.
 *
 * Violet rather than red for withdrawn, which it used to be: red is the banned
 * user and error colour on this page, and an admin retracting an invitation is
 * housekeeping rather than a fault. It also stays clear of amber, so a
 * withdrawn card cannot be mistaken for one that is still live.
 */
export default function InvitesPanel({
    invites,
    loadError,
    query = "",
}: {
    invites: Invite[];
    loadError?: string | null;
    /** Narrows the list to name/email, the same test the user cards use. */
    query?: string;
}) {
    const [error, setError] = useState<string | null>(null);
    const [revoking, setRevoking] = useState<string | null>(null);
    const [confirming, setConfirming] = useState<Invite | null>(null);
    const [pending, startTransition] = useTransition();
    const router = useRouter();

    const searching = query.trim() !== "";
    const shown = searching ? invites.filter((i) => inviteMatchesQuery(i, query)) : invites;

    // Escape closes the confirmation, and the page behind must not scroll while it
    // is up. Same treatment as the Invite user dialog, and deliberately no corner
    // X: the Cancel button and a backdrop click both cover it.
    useEffect(() => {
        if (!confirming) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setConfirming(null);
        };
        document.addEventListener("keydown", onKey);
        const previous = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            document.removeEventListener("keydown", onKey);
            document.body.style.overflow = previous;
        };
    }, [confirming]);

    const confirmRevoke = () => {
        if (!confirming) return;
        setError(null);
        setRevoking(confirming.id);
        startTransition(async () => {
            try {
                await revokeUserInvite(confirming.id);
                setConfirming(null);
                router.refresh();
            } catch (e) {
                setError(e instanceof Error ? e.message : "Could not withdraw that invitation.");
                setConfirming(null);
            } finally {
                setRevoking(null);
            }
        });
    };

    if (loadError) {
        return (
            <div className="mt-4 flex flex-col gap-2 rounded-[0.8em] border border-red-400/40 bg-red-500/10 px-4 py-4 text-sm text-red-500 dark:border-red-400/30 dark:bg-red-500/15 dark:text-red-400">
                <p className="font-medium">Could not load invitations.</p>
                <p>{loadError}</p>
                <p className="text-xs opacity-80">
                    If this mentions <code className="font-mono">user_invites</code>, apply the
                    pending Supabase migration{" "}
                    <code className="font-mono">20260928000000_user_invites.sql</code> (e.g.{" "}
                    <code className="font-mono">supabase db push</code>), then reload.
                </p>
            </div>
        );
    }

    if (shown.length === 0) {
        return (
            <div className="mt-4 rounded-[0.8em] border border-border bg-card px-4 py-10 text-center">
                <p className="text-sm text-muted-foreground">
                    {searching
                        ? "No invitations match your search."
                        : "No invitations sent yet. Use Invite user to bring somebody onto the platform."}
                </p>
            </div>
        );
    }

    return (
        <div className="mt-4 flex flex-col gap-3">
            {error && (
                <div
                    role="alert"
                    className="rounded-[0.8em] border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-500 dark:border-red-400/30 dark:bg-red-500/15 dark:text-red-400"
                >
                    {error}
                </div>
            )}

            <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {shown.map((invite) => {
                    const state = inviteState(invite);
                    const canRevoke = isWithdrawable(invite);

                    return (
                        <li
                            key={invite.id}
                            className={`rounded-[0.8em] border p-4 shadow-sm ${CARD_SKIN[state]}`}
                        >
                            <div className="flex items-center justify-between gap-3">
                                <div className="flex min-w-0 items-center gap-3">
                                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                                        {initials(invite.displayName, invite.email)}
                                    </span>
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-medium text-foreground">
                                            {invite.displayName ?? "(no name)"}
                                        </p>
                                        <p className="truncate text-xs text-muted-foreground">
                                            {invite.email}
                                        </p>
                                    </div>
                                </div>

                                {canRevoke && (
                                    <div className="ml-auto flex shrink-0 items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setConfirming(invite)}
                                            disabled={pending || revoking === invite.id}
                                            aria-label={`Withdraw the invitation to ${invite.email}`}
                                            className={`${ACTION_SHAPE} cursor-pointer border-amber-600/50 bg-amber-600/20 text-amber-800 hover:bg-amber-600/30 dark:text-amber-200 dark:hover:bg-amber-600/30 disabled:cursor-not-allowed disabled:opacity-50`}
                                        >
                                            <HiOutlineXCircle size={12} />
                                            {revoking === invite.id ? "…" : "Withdraw"}
                                        </button>
                                    </div>
                                )}

                                {state === "revoked" && (
                                    <div className="ml-auto flex shrink-0 items-center gap-2">
                                        {/* The action is spent, but the status has to stay
                                            on the card, so it repeats the button's shape
                                            without being a button. */}
                                        <span
                                            className={`${ACTION_SHAPE} border-violet-600/50 bg-violet-600/20 text-violet-800 dark:text-violet-200`}
                                        >
                                            <HiOutlineXCircle size={12} />
                                            Withdrawn
                                        </span>
                                    </div>
                                )}
                            </div>

                            <p className="mt-3 text-[0.7rem] text-muted-foreground/80">
                                Sent {formatDate(invite.createdAt)} | {stateNote(invite, state)}
                            </p>
                        </li>
                    );
                })}
            </ul>

            {confirming && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
                    onClick={() => setConfirming(null)}
                >
                    <div
                        className="w-full max-w-md rounded-[0.8em] border border-border bg-card p-6 shadow-lg"
                        onClick={(e) => e.stopPropagation()}
                        role="dialog"
                        aria-modal="true"
                        aria-label="Withdraw invitation"
                    >
                        <div className="flex items-center gap-2.5">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[0.6em] bg-amber-500/15 text-amber-600 dark:text-amber-400">
                                <HiOutlineXCircle size={18} />
                            </span>
                            <h2 className="text-base font-semibold text-foreground">
                                Withdraw invitation
                            </h2>
                        </div>

                        <p className="mt-3 text-sm text-foreground">
                            You are about to <strong>withdraw</strong> the invitation to{" "}
                            <strong>{confirming.email}</strong>. Their link stops working
                            immediately, and they will need a new invitation to join.
                        </p>

                        <div className="mt-5 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setConfirming(null)}
                                disabled={pending}
                                className="cursor-pointer rounded-[0.6em] border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={confirmRevoke}
                                disabled={pending}
                                className="w-full cursor-pointer rounded-[0.6em] border border-amber-600/50 bg-amber-600/20 px-8 py-2 text-sm font-medium text-amber-800 transition-colors hover:bg-amber-600/30 disabled:opacity-50 md:w-auto dark:text-amber-200"
                            >
                                {pending ? "Withdrawing…" : "Withdraw"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

/** Shared between the Withdraw action and the non-actionable Withdrawn pill. */
const ACTION_SHAPE =
    "flex items-center gap-1.5 rounded-[0.6em] border px-3 py-1.5 text-xs font-medium";

/**
 * Card surface per state, owning both `border-*` and `bg-*`.
 *
 * The base classes cannot carry `border-border bg-card` alongside these: the
 * theme registers `--color-card` in `@theme inline`, so Tailwind emits `.bg-card`
 * and `.border-border` *after* the palette utilities. Equal specificity means the
 * later rule wins and the tint would be silently dropped, which is why each state
 * supplies the full surface instead of a modifier.
 */
const CARD_SKIN: Record<InviteState, string> = {
    pending: "border-amber-400/70 bg-amber-500/15",
    accepted: "border-border bg-card",
    expired: "border-border bg-card",
    revoked: "border-violet-400/70 bg-violet-500/15",
};

function stateNote(invite: Invite, state: InviteState): string {
    if (state === "accepted") return `Joined ${formatDate(invite.acceptedAt ?? invite.createdAt)}`;
    if (state === "pending") return `Expires ${formatDate(invite.expiresAt)}`;
    if (state === "expired") return "Expired";
    return "Withdrawn";
}

function formatDate(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "unknown date";
    return d.toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
    });
}
