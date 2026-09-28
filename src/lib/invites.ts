/**
 * Admin-issued user invitations.
 *
 * Server-only. Talks to `public.user_invites` with the service-role client,
 * because that table has RLS enabled with no policies: the emailed link is the
 * capability, and anybody who could read the table could mint themselves an
 * invitation. The public /invite/accept page reaches this only through the
 * server action in src/app/manage-users/invite-actions.ts, which validates the
 * token on every call.
 *
 * Design notes:
 *  - The raw token is returned to the caller once, at creation, and never
 *    stored. Only its SHA-256 hash goes in the database, so a leaked dump of
 *    user_invites cannot be replayed into accounts.
 *  - The Supabase account is NOT created here. It is created when the invitee
 *    opens the link and sets a password. That keeps ignored invites out of
 *    auth.users and lets the same address be re-invited.
 *  - Tool access chosen by the admin is stored on the invite row, not on a user,
 *    for the same reason: the account does not exist yet. It is applied in
 *    src/app/invite/accept/actions.ts once the account is created. Public tools
 *    are still never written into `tool_access` — they are merged in at read time
 *    by `mergeToolAccess` — because a persisted grant would go stale if the tool
 *    were later made private. The same trap is documented on unbanUserWithTools in
 *    manage-users/actions.ts.
 */

import { createHash, randomBytes } from "node:crypto";
import { getServiceClient } from "./admin";
import { appUrl } from "./email/resend";
import { INVITE_TTL_DAYS, type Invite } from "./invite-shared";

/** Public path the emailed link points at. */
const ACCEPT_PATH = "/invite/accept";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export { INVITE_TTL_DAYS, isExpired } from "./invite-shared";
export type { Invite, InviteStatus } from "./invite-shared";

/** Supabase returns snake_case columns; the app speaks camelCase. */
function toInvite(row: Record<string, unknown>): Invite {
    return {
        id: String(row.id),
        email: String(row.email),
        displayName: (row.display_name as string | null) ?? null,
        status: row.status as Invite["status"],
        createdAt: String(row.created_at),
        expiresAt: String(row.expires_at),
        acceptedAt: (row.accepted_at as string | null) ?? null,
        // Null-tolerant: rows written before the granted_tools/blocked_tools
        // migration had neither column, and mean "no choice made" either way.
        grantedTools: toSlugList(row.granted_tools),
        blockedTools: toSlugList(row.blocked_tools),
    };
}

function toSlugList(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((s): s is string => typeof s === "string")
        : [];
}

export function hashInviteToken(token: string): string {
    return createHash("sha256").update(token, "utf8").digest("hex");
}

export function normaliseEmail(email: string): string {
    return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
    return EMAIL_RE.test(email);
}

/** The link that goes in the email. Only the caller ever sees the raw token. */
export function inviteAcceptUrl(token: string): string {
    return `${appUrl()}${ACCEPT_PATH}?token=${encodeURIComponent(token)}`;
}

export function expiresAtFromNow(): string {
    return new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export interface CreateInviteInput {
    email: string;
    displayName?: string | null;
    invitedBy?: string | null;
    /** Private tools to grant the invitee once they accept. */
    grantedTools?: string[];
    /** Public tools to block the invitee from once they accept. */
    blockedTools?: string[];
}

export interface CreatedInvite {
    invite: Invite;
    /** Raw token. Returned once so the caller can build the link; never stored. */
    token: string;
    acceptUrl: string;
}

/**
 * Create a pending invitation and return the raw token exactly once.
 *
 * Any earlier pending invite for the same address is revoked first, so only the
 * newest link works and "re-invite" doubles as "reissue a lost link".
 *
 * The tool lists are the admin's choice made at send time and are stored on the
 * row, because no account exists yet to hang them on. They are applied in
 * src/app/invite/accept/actions.ts at the moment the account is created.
 */
export async function createInvite({
    email,
    displayName,
    invitedBy,
    grantedTools = [],
    blockedTools = [],
}: CreateInviteInput): Promise<CreatedInvite> {
    const admin = getServiceClient();
    const address = normaliseEmail(email);

    const { error: revokeError } = await admin
        .from("user_invites")
        .update({ status: "revoked" })
        .eq("email", address)
        .eq("status", "pending");
    if (revokeError) throw revokeError;

    // 32 random bytes = 256 bits of entropy, so the token is not guessable even
    // though the accept endpoint is unauthenticated.
    const token = randomBytes(32).toString("base64url");
    const expiresAt = expiresAtFromNow();

    const { data, error } = await admin
        .from("user_invites")
        .insert({
            email: address,
            display_name: displayName?.trim() || null,
            token_hash: hashInviteToken(token),
            status: "pending",
            invited_by: invitedBy ?? null,
            expires_at: expiresAt,
            granted_tools: [...new Set(grantedTools)],
            blocked_tools: [...new Set(blockedTools)],
        })
        .select()
        .single();
    if (error) throw error;

    const invite = toInvite(data as Record<string, unknown>);
    return { invite, token, acceptUrl: inviteAcceptUrl(token) };
}

/** Look up an invite by raw token, without judging whether it is still usable. */
export async function findInviteByToken(token: string): Promise<Invite | null> {
    const { data, error } = await getServiceClient()
        .from("user_invites")
        .select("*")
        .eq("token_hash", hashInviteToken(token))
        .maybeSingle();
    if (error) throw error;
    return data ? toInvite(data as Record<string, unknown>) : null;
}

export type InviteLookup =
    | { ok: true; invite: Invite }
    | { ok: false; reason: "invalid" | "expired" | "used" | "revoked" };

/**
 * Resolve a raw token to a usable invitation.
 *
 * The reasons are returned rather than thrown so the accept page can show
 * something actionable, but they are deliberately coarse: telling an anonymous
 * visitor the difference between "never existed" and "already used" turns this
 * into an oracle for probing whether an address was ever invited.
 */
export async function resolvePendingInvite(token: string): Promise<InviteLookup> {
    const invite = await findInviteByToken(token);
    if (!invite) return { ok: false, reason: "invalid" };
    if (invite.status === "accepted") return { ok: false, reason: "used" };
    if (invite.status === "revoked") return { ok: false, reason: "revoked" };
    if (Date.parse(invite.expiresAt) <= Date.now()) return { ok: false, reason: "expired" };
    return { ok: true, invite };
}

/**
 * Flip a pending invite to accepted.
 *
 * Guarded on status and expiry in the WHERE clause rather than checked-then-
 * written, so two concurrent accepts of the same link cannot both succeed. The
 * caller must therefore treat an empty result as "someone else got there first".
 */
export async function markInviteAccepted(id: string): Promise<boolean> {
    const { data, error } = await getServiceClient()
        .from("user_invites")
        .update({ status: "accepted", accepted_at: new Date().toISOString() })
        .eq("id", id)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();
    if (error) throw error;
    return !!data;
}

/**
 * Withdraw an invitation, or undo one whose email could not be sent.
 *
 * Guarded on `status = 'pending'` so this can never overwrite a terminal
 * outcome. An invitation the invitee has already accepted stays `accepted`, and
 * one they have already declined stays `revoked` — re-withdrawing is a no-op
 * rather than a second state change. That guard is also what makes the admin
 * Withdraw button safe to expose without a fresh read: by the time the click
 * lands the row may already have been accepted, and silently doing nothing is the
 * right outcome, since the account exists and the link is spent either way.
 */
export async function revokeInvite(id: string): Promise<void> {
    const { error } = await getServiceClient()
        .from("user_invites")
        .update({ status: "revoked" })
        .eq("id", id)
        .eq("status", "pending");
    if (error) throw error;
}

/**
 * Hand a claimed invitation back so the same link still works.
 *
 * Only used when account creation fails for a reason that might not repeat
 * (network blip, Supabase 5xx). Never used when the address is already taken —
 * the link can never succeed in that case, so it stays consumed. Guarded on
 * status and on accepted_at still being null so a late retry cannot resurrect an
 * invitation that has in fact been used.
 */
export async function releaseInviteClaim(id: string): Promise<void> {
    const { error } = await getServiceClient()
        .from("user_invites")
        .update({ status: "pending", accepted_at: null })
        .eq("id", id)
        .eq("status", "accepted")
        .is("accepted_at", null);
    if (error) throw error;
}

/** Pending invites, newest first. */
export async function listPendingInvites(): Promise<Invite[]> {
    const { data, error } = await getServiceClient()
        .from("user_invites")
        .select("*")
        .eq("status", "pending")
        .order("created_at", { ascending: false });
    if (error) throw error;
    return ((data ?? []) as Record<string, unknown>[]).map(toInvite);
}

/**
 * Every invitation, newest first, for the admin "Invites sent" tab.
 *
 * Kept separate from listPendingInvites so the tab can show what happened to
 * each one — an accepted or withdrawn invitation is history worth keeping
 * visible, not something to hide.
 */
export async function listInvites(): Promise<Invite[]> {
    const { data, error } = await getServiceClient()
        .from("user_invites")
        .select("*")
        .order("created_at", { ascending: false });
    if (error) throw error;
    return ((data ?? []) as Record<string, unknown>[]).map(toInvite);
}
