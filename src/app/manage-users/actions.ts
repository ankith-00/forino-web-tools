"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { isAdmin } from "@/lib/access";
import { clearPublicToolsCache, fetchPublicTools } from "@/lib/public-tools";
import {
    grantToolAccess,
    revokeToolAccess,
    toggleBlockedTool as svcToggleBlockedTool,
    setToolPublic as svcSetToolPublic,
    banUser as svcBanUser,
    unbanUser as svcUnbanUser,
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