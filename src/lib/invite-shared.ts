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
