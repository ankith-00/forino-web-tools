"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { isAdmin } from "@/lib/access";
import { clearPublicToolsCache, fetchPublicTools } from "@/lib/public-tools";
import { inviteEmail } from "@/lib/email/templates/invite-email";
import { sendEmail } from "@/lib/email/resend";
import { createInvite, isValidEmail, normaliseEmail, revokeInvite } from "@/lib/invites";
import {
    grantToolAccess,
    revokeToolAccess,
    toggleBlockedTool as svcToggleBlockedTool,
    setToolPublic as svcSetToolPublic,
    banUser as svcBanUser,
    unbanUser as svcUnbanUser,
    listUsers,
} from "@/lib/admin";

/** Only signed-in admins may run these actions. */
async function assertAdmin() {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();
    if (!user || !isAdmin(user)) {
        throw new Error("Not authorized — admin access required.");
    }
    return user;
}

/** Toggle a tool grant for a user. `granted` is the current state; flip it. */
export async function toggleToolAccess(userId: string, slug: string, currentlyGranted: boolean) {
    await assertAdmin();
    if (currentlyGranted) {
        await revokeToolAccess(userId, slug);
    } else {
        await grantToolAccess(userId, slug);
    }
    revalidatePath("/manage-users");
    revalidatePath("/dashboard");
}

/** Make a tool public (visible + usable by everyone) or private again. */
export async function toggleToolPublic(slug: string, isPublic: boolean) {
    await assertAdmin();
    await svcSetToolPublic(slug, isPublic);
    clearPublicToolsCache();
    revalidatePath("/manage-users");
    revalidatePath("/dashboard");
}

/** Block/unblock a user from a tool. Blocked tools override public + granted access. */
export async function toggleBlockedTool(userId: string, slug: string) {
    await assertAdmin();
    await svcToggleBlockedTool(userId, slug);
    revalidatePath("/manage-users");
    revalidatePath("/dashboard");
}

/** Ban a user from the entire platform. */
export async function banUserFromPlatform(userId: string) {
    await assertAdmin();
    await svcBanUser(userId);
    revalidatePath("/manage-users");
}

/** Unban a user from the platform. */
export async function unbanUserFromPlatform(userId: string) {
    await assertAdmin();
    await svcUnbanUser(userId);
    revalidatePath("/manage-users");
}

/** Unban a user with custom tool access and blocked tools. */
export async function unbanUserWithTools(userId: string, grantedTools: string[], blockedTools: string[]) {
    await assertAdmin();
    const { createClient: createAdminClient } = await import("@supabase/supabase-js");
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Missing admin env vars");
    const admin = createAdminClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

    // Public tools are granted implicitly at read time (mergeToolAccess), so they
    // must NOT be persisted into tool_access — otherwise a user keeps a stale
    // individual grant if the tool is later made private.
    const publicTools = await fetchPublicTools(await createClient());
    const privateGrants = grantedTools.filter((slug) => !publicTools.includes(slug));

    // Unban the user
    await admin.auth.admin.updateUserById(userId, { ban_duration: "none" });

    // Set granted tool access
    const { data: user } = await admin.auth.admin.getUserById(userId);
    const existing = user?.user?.app_metadata ?? {};
    await admin.auth.admin.updateUserById(userId, {
        app_metadata: {
            ...existing,
            tool_access: [...new Set(privateGrants)],
            blocked_tools: [...new Set(blockedTools)],
        },
    });

    revalidatePath("/manage-users");
    revalidatePath("/dashboard");
}

const BRAND_NAME = "Forino";

export interface InviteUserResult {
    ok: boolean;
    message: string;
}

/**
 * Invite somebody to the platform by name and email.
 *
 * The Supabase account is not created here. The invitee gets a link, chooses
 * their own password, and only then does the account appear — so an invitation
 * that bounces or is ignored leaves nothing behind in auth.users, and the same
 * address can be re-invited. The new account comes up as a normal user with no
 * individual tool grants, which means it sees exactly the public tools at read
 * time (see src/lib/invites.ts for why nothing is persisted here).
 *
 * Returns a result rather than throwing, because unlike the toggle actions this
 * one has a success path the admin needs to see. Failures that are the admin's
 * to fix come back as ok:false; anything unexpected is logged and reported
 * generically so internals don't leak into the UI.
 */
export async function inviteUser(name: string, email: string): Promise<InviteUserResult> {
    await assertAdmin();

    const displayName = name.trim();
    const address = normaliseEmail(email);

    if (!displayName) {
        return { ok: false, message: "Enter the person's name." };
    }
    if (displayName.length > 120) {
        return { ok: false, message: "That name is too long." };
    }
    if (!isValidEmail(address)) {
        return { ok: false, message: "Enter a valid email address." };
    }

    // Catch the duplicate before the email goes out. Supabase's admin API has no
    // lookup-by-email, and the accept path would otherwise fail much later with a
    // confusing message; this page already loads the full user list, so reuse it.
    try {
        const clash = (await listUsers()).find((u) => u.email?.toLowerCase() === address);
        if (clash) {
            return {
                ok: false,
                message: `${address} already has a ${BRAND_NAME} account. Grant them tools instead.`,
            };
        }
    } catch (e) {
        console.error("[invite] user lookup failed:", e);
        return { ok: false, message: "Could not check whether that email is already registered." };
    }

    let created: Awaited<ReturnType<typeof createInvite>>;
    try {
        created = await createInvite({ email: address, displayName });
    } catch (e) {
        // Almost always the migration has not been applied yet.
        console.error("[invite] createInvite failed:", e);
        return {
            ok: false,
            message: "Could not create the invitation. If this mentions user_invites, apply the pending Supabase migration 20260928000000_user_invites.sql.",
        };
    }

    try {
        const message = inviteEmail({ acceptUrl: created.acceptUrl, displayName });
        await sendEmail({ to: address, ...message });
    } catch (e) {
        // Don't leave a pending invitation pointing at an email that was never
        // sent — it would show up as outstanding forever.
        console.error("[invite] send failed:", e);
        try {
            await revokeInvite(created.invite.id);
        } catch (cleanupErr) {
            console.error("[invite] revoke after send failure failed:", cleanupErr);
        }
        return {
            ok: false,
            message: "The invitation could not be emailed. Check RESEND_FROM_EMAIL and RESEND_API_KEY, then try again.",
        };
    }

    revalidatePath("/manage-users");
    return {
        ok: true,
        // Deliberately terse: this renders as a green toast inside the dialog, and
        // the admin is looking at the address they just typed. The interesting
        // part (the password link) is in the email, not here.
        message: "Invitation sent.",
    };
}

/**
 * Withdraw a pending invitation so its link stops working.
 *
 * Re-inviting the same address already supersedes the old link, but an invite
 * sent to a mistyped address has no other way to be cleaned up. Only pending
 * invitations can be withdrawn — once accepted the account exists, and the admin
 * should ban or delete that user instead.
 */
export async function revokeUserInvite(inviteId: string): Promise<void> {
    await assertAdmin();
    await revokeInvite(inviteId);
    revalidatePath("/manage-users");
}