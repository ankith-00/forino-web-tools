/**
 * Server-side access lookups (Node runtime). Imports next/headers, so keep this
 * away from the edge proxy — the proxy uses the pure helpers in `@/lib/access`.
 */
import { createClient } from "@/utils/supabase/server";
import { canAccessTool, mergeToolAccess, userAccess, type UserAccess } from "@/lib/access";
import { fetchPublicTools } from "@/lib/public-tools";

/** Current signed-in user's access label, or null if not authenticated. */
export async function getCurrentAccess(): Promise<UserAccess | null> {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    const publicTools = await fetchPublicTools(supabase);
    return mergeToolAccess(userAccess(user), publicTools);
}

/** Redirect-worthy helper for pages that require a specific tool. */
export async function requireToolAccess(slug: string) {
    const access = await getCurrentAccess();
    if (!access) return { access: null as null, granted: false };
    return { access, granted: canAccessTool(access, slug) };
}