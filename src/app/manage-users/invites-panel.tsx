"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { HiOutlineXCircle } from "react-icons/hi";
import { revokeUserInvite } from "./actions";
import type { Invite } from "@/lib/invite-shared";
import { inviteState, isWithdrawable } from "@/lib/invite-shared";

/**
 * The "Invites sent" tab: every invitation ever issued, newest first, with what
 * became of it. Kept out of users-table.tsx because that file is already large
 * and this is a different entity with different columns.
 */
export default function InvitesPanel({
    invites,
    loadError,
}: {
    invites: Invite[];
    loadError?: string | null;
}) {
    const [error, setError] = useState<string | null>(null);
    const [revoking, setRevoking] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();
    const router = useRouter();

    const revoke = (id: string, email: string) => {
        if (!window.confirm(`Withdraw the invitation to ${email}? Their link will stop working.`)) {
            return;
        }
        setError(null);
        setRevoking(id);
        startTransition(async () => {
            try {
                await revokeUserInvite(id);
                router.refresh();
            } catch (e) {
                setError(e instanceof Error ? e.message : "Could not withdraw that invitation.");
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

    if (invites.length === 0) {
        return (
            <div className="mt-4 rounded-[0.8em] border border-border bg-card px-4 py-10 text-center">
                <p className="text-sm text-muted-foreground">
                    No invitations sent yet. Use Invite user to bring somebody onto the platform.
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

            <ul className="flex flex-col gap-2">
                {invites.map((invite) => {
                    const state = inviteState(invite);
                    const canRevoke = isWithdrawable(invite);

                    return (
                        <li
                            key={invite.id}
                            className="flex flex-wrap items-center justify-between gap-3 rounded-[0.8em] border border-border bg-card px-4 py-3"
                        >
                            <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-foreground">
                                    {invite.displayName ?? "(no name)"}
                                </p>
                                <p className="truncate text-xs text-muted-foreground">
                                    {invite.email}
                                </p>
                                <p className="mt-1 text-[0.7rem] text-muted-foreground/80">
                                    Sent {formatDate(invite.createdAt)}
                                    {invite.status === "accepted"
                                        ? ` · joined ${formatDate(invite.acceptedAt ?? invite.createdAt)}`
                                        : ` · ${state === "pending" ? `expires ${formatDate(invite.expiresAt)}` : state}`}
                                </p>
                            </div>

                            <div className="flex shrink-0 items-center gap-2">
                                <Badge state={state} />
                                {canRevoke && (
                                    <button
                                        type="button"
                                        onClick={() => revoke(invite.id, invite.email)}
                                        disabled={pending || revoking === invite.id}
                                        aria-label={`Withdraw the invitation to ${invite.email}`}
                                        className="flex cursor-pointer items-center gap-1.5 rounded-[0.5em] border border-border bg-background px-2.5 py-1.5 text-xs text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        <HiOutlineXCircle size={14} className="text-muted-foreground" />
                                        {revoking === invite.id ? "…" : "Withdraw"}
                                    </button>
                                )}
                            </div>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}

const BADGE: Record<string, { label: string; className: string }> = {
    pending: {
        label: "Pending",
        className: "bg-muted text-foreground",
    },
    accepted: {
        label: "Joined",
        className: "bg-green-500/20 text-green-600 dark:text-green-400",
    },
    expired: {
        label: "Expired",
        className: "bg-amber-500/20 text-amber-600 dark:text-amber-400",
    },
    revoked: {
        label: "Withdrawn",
        className: "bg-red-500/15 text-red-600 dark:text-red-400",
    },
};

function Badge({ state }: { state: string }) {
    const b = BADGE[state] ?? BADGE.pending;
    return (
        <span
            className={`rounded-full px-2 py-0.5 text-[0.7rem] font-semibold ${b.className}`}
        >
            {b.label}
        </span>
    );
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
