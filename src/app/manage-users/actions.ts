"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { isAdmin } from "@/lib/access";
import { clearPublicToolsCache } from "@/lib/public-tools";
import {
    grantToolAccess,
    revokeToolAccess,
    toggleBlockedTool as svcToggleBlockedTool,
    setToolPublic as svcSetToolPublic,
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