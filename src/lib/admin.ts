/**
 * Server-only admin helpers backed by the Supabase service-role key.
 * Never import this module from client code — it reads a secret env var.
 * The client is created lazily so the app still boots when the key is unset,
 * and the /manage-users page can surface an actionable error.
 */
import { createClient as createAdminClient, type SupabaseClient } from "@supabase/supabase-js";
import { userAccess, type AdminUser } from "@/lib/access";
import { normaliseBranding, userBranding } from "@/lib/site-branding";

let lazilyCreated: SupabaseClient | null = null;

function getAdmin(): SupabaseClient {
    if (!lazilyCreated) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!url || !key) {
            throw new Error(
                "Admin helpers need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars."
            );
        }
        lazilyCreated = createAdminClient(url, key, {
            auth: { autoRefreshToken: false, persistSession: false },
        });
    }
    return lazilyCreated;
}

/** Export for server-side routes that need service-role writes (e.g. /api/attendance). */
export function getServiceClient(): SupabaseClient {
    return getAdmin();
}

function toAdminUser(u: {
    id: string;
    email?: string | null;
    user_metadata?: unknown;
    app_metadata?: unknown;
    created_at?: string | null;
    banned_until?: string | null;
}): AdminUser {
    const existing = u.user_metadata as Record<string, unknown> | undefined;
    const access = userAccess(u);
    const branding = userBranding(u);
    const banned = !!u.banned_until;
    return {
        id: u.id,
        email: u.email ?? null,
        displayName:
            (existing?.display_name as string | undefined) ??
            (existing?.name as string | undefined) ??
            null,
        role: access.role,
        toolAccess: access.toolAccess,
        blockedTools: access.blockedTools ?? [],
        siteTitle: branding.siteTitle,
        footerNote: branding.footerNote,
        createdAt: u.created_at ?? null,
        banned,
    };
}

export async function listUsers(): Promise<AdminUser[]> {
    const { data, error } = await getAdmin().auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error) throw error;
    return data.users.map(toAdminUser);
}

/**
 * Map auth user ids to the display name `toAdminUser` would produce, so a name
 * shown outside the admin panel can never disagree with the one in it.
 *
 * `attendance.marked_by` is a bare uuid, which is unreadable in a table, so
 * callers resolve it through here. One list call rather than a lookup per id:
 * the number of distinct markers is bounded by the institution, not by the
 * number of rows.
 */
export function displayNamesById(users: AdminUser[]): Record<string, string> {
    return Object.fromEntries(
        users.map((u) => [u.id, u.displayName ?? u.email ?? "Unknown"])
    );
}

export async function setToolAccess(userId: string, slugs: string[]): Promise<void> {
    const { data: user } = await getAdmin().auth.admin.getUserById(userId);
    const existing = user?.user?.app_metadata ?? {};
    const { error } = await getAdmin().auth.admin.updateUserById(userId, {
        app_metadata: { ...existing, tool_access: slugs },
    });
    if (error) throw error;
}

export async function grantToolAccess(userId: string, slug: string): Promise<void> {
    const { data: user } = await getAdmin().auth.admin.getUserById(userId);
    const access = userAccess(user?.user ?? null);
    if (access.toolAccess.includes(slug)) return;
    await setToolAccess(userId, [...access.toolAccess, slug]);
}

export async function revokeToolAccess(userId: string, slug: string): Promise<void> {
    const { data: user } = await getAdmin().auth.admin.getUserById(userId);
    const access = userAccess(user?.user ?? null);
    await setToolAccess(
        userId,
        access.toolAccess.filter((s) => s !== slug)
    );
}

/**
 * Write the blocked-tool list into app_metadata (merges, avoids clobbering).
 * Blocked tools override public access and individual grants everywhere.
 */
export async function setBlockedTools(userId: string, slugs: string[]): Promise<void> {
    const { data: user } = await getAdmin().auth.admin.getUserById(userId);
    const existing = user?.user?.app_metadata ?? {};
    const { error } = await getAdmin().auth.admin.updateUserById(userId, {
        app_metadata: { ...existing, blocked_tools: [...new Set(slugs)] },
    });
    if (error) throw error;
}

/** Flip the block state for one tool; returns the new state (true = now blocked). */
export async function toggleBlockedTool(userId: string, slug: string): Promise<boolean> {
    const { data: user } = await getAdmin().auth.admin.getUserById(userId);
    const access = userAccess(user?.user ?? null);
    const blockedTools = access.blockedTools ?? [];
    const blocked = blockedTools.includes(slug);
    const next = blocked
        ? blockedTools.filter((s) => s !== slug)
        : [...blockedTools, slug];
    await setBlockedTools(userId, next);
    return !blocked;
}

/** Mark a tool public (upsert) or private (delete the flag row). */
export async function setToolPublic(slug: string, isPublic: boolean): Promise<void> {
    const admin = getAdmin();
    let result: { error: { message: string } | null };
    if (isPublic) {
        result = await admin
            .from("tool_settings")
            .upsert({ slug, is_public: true }, { onConflict: "slug" });
    } else {
        result = await admin.from("tool_settings").delete().eq("slug", slug);
    }
    if (result.error) throw result.error;
}

/**
 * Write one user's site branding into `app_metadata`.
 *
 * Merges onto the existing metadata rather than replacing it, because
 * `app_metadata` also holds `role`, `tool_access` and `blocked_tools` — replacing
 * it wholesale would silently strip a user's access every time an admin renamed
 * their app. Input is normalised first, so a blank field is stored as `null` and
 * reads back as "use the platform default".
 *
 * Always writes both keys, even when one is unchanged, so a user can never end up
 * with a brand that is half-set from two different saves.
 */
export async function setUserBranding(userId: string, input: { siteTitle: string; footerNote: string }): Promise<void> {
    const branding = normaliseBranding(input);
    const { data, error: readError } = await getAdmin().auth.admin.getUserById(userId);

    // Bail rather than writing onto a metadata object we failed to read. Spreading
    // an empty object here would replace app_metadata wholesale and strip the user's
    // role and tool access, which is far worse than reporting the failure.
    if (readError) throw readError;
    if (!data?.user) throw new Error("That user no longer exists.");

    const existing = data.user.app_metadata ?? {};

    const { error } = await getAdmin().auth.admin.updateUserById(userId, {
        app_metadata: {
            ...existing,
            site_title: branding.siteTitle,
            footer_note: branding.footerNote,
        },
    });
    if (error) throw error;
}

/** Ban a user from the entire platform. */
export async function banUser(userId: string): Promise<void> {
    const { error } = await getAdmin().auth.admin.updateUserById(userId, {
        ban_duration: "87600h", // 10 years - effectively permanent
    });
    if (error) throw error;
}

/** Unban a user from the platform. */
export async function unbanUser(userId: string): Promise<void> {
    const { error } = await getAdmin().auth.admin.updateUserById(userId, {
        ban_duration: "none",
    });
    if (error) throw error;
}

/** Check if a user is currently banned. */
export async function isUserBanned(userId: string): Promise<boolean> {
    const { data: user } = await getAdmin().auth.admin.getUserById(userId);
    return user?.user?.banned_until !== null && user?.user?.banned_until !== undefined;
}