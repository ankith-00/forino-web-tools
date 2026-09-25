/**
 * Shared lookup of PUBLIC tools (from `public.tool_settings`).
 * Safe to import from the edge proxy, server components, and client components —
 * it only needs any supabase-js client (anon key works because RLS allows
 * authenticated SELECT).
 *
 * Results are cached in-process for a short TTL so pages, API routes, and the
 * proxy don't hammer PostgREST on every request. On a transient DB failure the
 * last-known-good set is returned instead of an empty list, so public tools
 * don't silently disappear during a hiccup.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

const TTL_MS = 20_000;

const cacheStore = new Map<string, { at: number; tools: string[] }>();

export function clearPublicToolsCache() {
    cacheStore.clear();
}

export async function fetchPublicTools(supabase: Pick<SupabaseClient, "from">): Promise<string[]> {
    const now = Date.now();
    const hit = cacheStore.get("public-tools");
    if (hit && now - hit.at < TTL_MS) {
        return hit.tools;
    }

    const { data, error } = await supabase
        .from("tool_settings")
        .select("slug")
        .eq("is_public", true);
    if (error) {
        // Fail with the last-known-good set rather than silently revoking access.
        if (hit) return hit.tools;
        return [];
    }
    const rows = data as unknown as Array<{ slug: string }> | null;
    const tools = (rows ?? []).map((r) => r.slug);
    cacheStore.set("public-tools", { at: now, tools });
    return tools;
}