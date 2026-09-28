/**
 * Types and pure predicates for invitations.
 *
 * Deliberately separate from ./invites, which imports the service-role Supabase
 * client. Client components need `Invite` and the state logic to render the
 * "Invites sent" tab, and must not pull admin credentials into the browser
 * bundle just to learn a status label. Anything in this file is safe to import
 * from a client component.
 */

export const INVITE_TTL_DAYS = 7;

export type InviteStatus = "pending" | "accepted" | "revoked";

export interface Invite {
    id: string;
    email: string;
    displayName: string | null;
    status: InviteStatus;
    createdAt: string;
    expiresAt: string;
    acceptedAt: string | null;
    /**
     * What the admin picked when sending the invitation, applied to the auth
     * account on acceptance. Split in two because public tools are already granted
     * to everyone at read time by `mergeToolAccess`, so the only way to *deny* one
     * is a block:
     *  - grantedTools: private tools to grant individually.
     *  - blockedTools: public tools the admin switched off for this person.
     */
    grantedTools: string[];
    blockedTools: string[];
}

/**
 * The status as an admin should read it, which is not quite the stored status:
 * a pending invitation past its expiry is spent even though nobody has touched
 * the row, and that is the state an admin will hit most often.
 */
export type InviteState = "pending" | "accepted" | "expired" | "revoked";

export function isExpired(invite: Invite, now = Date.now()): boolean {
    return Date.parse(invite.expiresAt) <= now;
}

export function inviteState(invite: Invite, now = Date.now()): InviteState {
    if (invite.status === "accepted") return "accepted";
    if (invite.status === "revoked") return "revoked";
    return isExpired(invite, now) ? "expired" : "pending";
}

/** Only a still-pending invitation can be withdrawn or re-sent. */
export function isWithdrawable(invite: Invite, now = Date.now()): boolean {
    return inviteState(invite, now) === "pending";
}

/**
 * Name-or-email match, the same test the user cards apply. Shared so the invite
 * tab and the search-results list of invites cannot drift apart.
 */
export function inviteMatchesQuery(invite: Invite, query: string): boolean {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
        invite.displayName?.toLowerCase().includes(q) === true ||
        invite.email.toLowerCase().includes(q)
    );
}
