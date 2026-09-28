"use server";

/**
 * Public, unauthenticated action for redeeming an invitation.
 *
 * This is reachable by direct POST from anyone holding the emailed link, so the
 * token is the authorization and is re-validated on every call. It lives here
 * rather than in manage-users/actions.ts because the admin guard there is the
 * opposite of what applies: the invitee is by definition not signed in.
 */

import { headers } from "next/headers";
import { getServiceClient } from "@/lib/admin";
import {
    markInviteAccepted,
    releaseInviteClaim,
    resolvePendingInvite,
} from "@/lib/invites";

/**
 * Attempts per IP per hour. The token carries 256 bits of entropy, so this is
 * not what protects the endpoint — it exists to stop a forwarded or shared link
 * being hammered, and to keep an unauthenticated POST from turning the Supabase
 * admin API into a free account-creation oracle. Generous enough that someone
 * correcting a typo a few times never notices it.
 */
const WINDOW_MS = 60 * 60 * 1000;
const LIMIT = 20;

/**
 * In-memory, so it resets on redeploy and is per-instance. Same tradeoff as the
 * limiter on /api/auth/register; a durable limit would need a table, and the
 * token's entropy is the real control here.
 */
const attemptLog = new Map<string, number[]>();

function clientKey(headers: Headers): string {
    const forwarded = headers.get("x-forwarded-for");
    return forwarded?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown";
}

function rateLimited(headers: Headers): boolean {
    const key = clientKey(headers);
    const now = Date.now();
    const recent = (attemptLog.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
    if (recent.length >= LIMIT) {
        attemptLog.set(key, recent);
        return true;
    }
    recent.push(now);
    attemptLog.set(key, recent);
    return false;
}

/** Same rules as /api/auth/register, so a password is good enough to log in with. */
const SPECIAL_CHAR_RE = /[!@#$%^&*(),.?":{}|<>]/;

function validatePassword(password: string): string | null {
    if (password.length < 6) return "Password must be at least 6 characters.";
    if (!/\d/.test(password)) return "Password must contain a number.";
    if (!SPECIAL_CHAR_RE.test(password)) return "Password must contain a special character.";
    return null;
}

/**
 * True when the address is already taken. The wording is deliberately vague: a
 * stranger holding a leaked link can otherwise use this to enumerate which
 * addresses have accounts here.
 */
function isAlreadyRegistered(message: string): boolean {
    const m = message.toLowerCase();
    return m.includes("already") || m.includes("registered") || m.includes("exists");
}

export interface AcceptInviteResult {
    ok: boolean;
    error?: string;
    /** Set when the invite is spent, so the client can offer "sign in instead". */
    alreadyRegistered?: boolean;
}

export async function acceptInvite(
    token: string,
    password: string,
    acceptedTerms: boolean
): Promise<AcceptInviteResult> {
    if (rateLimited(await headers())) {
        return {
            ok: false,
            error: "Too many attempts. Wait an hour, or ask the person who invited you to send a new link.",
        };
    }

    if (!token || typeof token !== "string" || token.length < 20) {
        return { ok: false, error: "This invitation link is not valid." };
    }
    // The form makes this unskippable, but this action is reachable by direct POST
    // from anyone holding the link, so the acceptance is checked here too. It is
    // only a statement of intent, so it is not recorded beyond the account itself.
    if (acceptedTerms !== true) {
        return { ok: false, error: "Please accept the terms and conditions to continue." };
    }
    const passwordError = validatePassword(password ?? "");
    if (passwordError) return { ok: false, error: passwordError };

    // Every database touch below is wrapped: this action is publicly reachable,
    // so a missing migration or a Supabase outage must come back as a message the
    // invitee can act on rather than a 500.
    let lookup;
    try {
        lookup = await resolvePendingInvite(token);
    } catch (e) {
        console.error("[invite/accept] resolve failed:", e);
        return {
            ok: false,
            error: "We couldn't check that invitation just now. Please try again in a moment.",
        };
    }
    if (!lookup.ok) {
        return {
            ok: false,
            error:
                lookup.reason === "expired"
                    ? "This invitation has expired. Ask for a new one and it can be sent again."
                    : lookup.reason === "used"
                      ? "This invitation has already been used. If that was you, just sign in."
                      : "This invitation link is not valid. Ask for a new one to be sent.",
        };
    }
    const { invite } = lookup;

    // Claim first, then create. createUser is already unique on email, so a
    // duplicate would be rejected anyway — but claiming first means a replayed
    // link cannot even reach that check, and only one concurrent accept wins.
    let claimed: boolean;
    try {
        claimed = await markInviteAccepted(invite.id);
    } catch (e) {
        console.error("[invite/accept] claim failed:", e);
        return { ok: false, error: "We couldn't reach our database. Please try again." };
    }
    if (!claimed) {
        return {
            ok: false,
            error: "This invitation has already been used. If that was you, just sign in.",
            alreadyRegistered: true,
        };
    }

    const admin = getServiceClient();
    // Set the moment the account exists, so the catch below can tell "nothing was
    // created, retry is safe" from "the account is real, the link is spent".
    let createdUserId: string | null = null;
    try {
        // email_confirm: true because the admin vouched for this address and the
        // invitee proved control of it by opening the emailed link. The
        // set_default_access_metadata trigger assigns role "user" and an empty
        // tool_access, and public tools are merged in at read time.
        const { data, error } = await admin.auth.admin.createUser({
            email: invite.email,
            password,
            email_confirm: true,
            user_metadata: { display_name: invite.displayName },
        });
        if (error) throw error;
        createdUserId = data.user.id;

        // Now apply the tool access the admin chose when they sent the invitation.
        // It cannot ride along on createUser: the trigger concatenates
        // `{"role":"user","tool_access":[]}` over whatever app_metadata it is
        // given, and in jsonb `||` the right side wins, so the grant would be
        // overwritten. Write it afterwards instead, in one call so a half-applied
        // set is not possible.
        if (invite.grantedTools.length > 0 || invite.blockedTools.length > 0) {
            const { data: fresh } = await admin.auth.admin.getUserById(createdUserId);
            const existing = (fresh?.user?.app_metadata ?? {}) as Record<string, unknown>;
            const { error: accessError } = await admin.auth.admin.updateUserById(createdUserId, {
                app_metadata: {
                    ...existing,
                    tool_access: invite.grantedTools,
                    blocked_tools: invite.blockedTools,
                },
            });
            if (accessError) throw accessError;
        }
    } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        console.error("[invite/accept] createUser failed:", detail);

        if (isAlreadyRegistered(detail)) {
            // Leave the invitation consumed: the address can never accept it.
            return {
                ok: false,
                error: "That email already has an account. Sign in with your existing password instead.",
                alreadyRegistered: true,
            };
        }

        // The account is real but its access is not set, so the link is spent and
        // handing it back would only produce a duplicate-email error on retry.
        // Say what actually happened and who can fix it.
        if (createdUserId) {
            return {
                ok: false,
                error:
                    "Your account was created, but we could not finish setting up your tools. Ask the person who invited you to set your access, then sign in.",
                alreadyRegistered: true,
            };
        }

        // Nothing was created: give the link back so a retry can work.
        try {
            await releaseInviteClaim(invite.id);
        } catch (releaseErr) {
            console.error("[invite/accept] could not release claim:", releaseErr);
        }
        return {
            ok: false,
            error: "We couldn't create your account just now. Please try again in a moment.",
        };
    }

    return { ok: true };
}
