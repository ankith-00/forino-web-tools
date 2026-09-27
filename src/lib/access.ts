/**
 * Pure access-model helpers. Safe to import from anywhere, including the
 * edge-runtime proxy (no next/headers, no DB). Server-side lookups live in
 * `@/lib/access-server`.
 */

export type Role = "user" | "admin";

interface HasAppMetadata {
    app_metadata?: unknown;
}

export interface ToolDef {
  slug: string;
  path: string;
  /** Display name. Lives here so the navbar and the dashboard can never disagree. */
  title: string;
}

export const TOOLS: readonly ToolDef[] = [
  { slug: "scanner", path: "/scanner", title: "Invigilation Module" },
  { slug: "webcam-scanner", path: "/webcam-scanner", title: "Booklet Scanner" },
  { slug: "barcode", path: "/barcode", title: "Barcode Marker" },
  { slug: "id-card", path: "/id-card", title: "ID Card Maker" },
  { slug: "attendance-records", path: "/attendance-records", title: "Attendance Records" },
];

export interface UserAccess {
    role: Role;
    toolAccess: string[];
    /** Tools this user is barred from — overrides public access and individual grants. */
    blockedTools?: string[];
}

/** Shape used by the admin panel (kept here so client components can type-only import it). */
export interface AdminUser {
    id: string;
    email: string | null;
    displayName: string | null;
    role: Role;
    toolAccess: string[];
    blockedTools: string[];
    createdAt: string | null;
    banned: boolean;
}

/** Extract the access label from a user-like object (safe on client/server/edge). */
export function userAccess(user: HasAppMetadata | null | undefined): UserAccess {
    const meta = (user?.app_metadata ?? {}) as Record<string, unknown>;
    const role: Role = meta.role === "admin" ? "admin" : "user";
    const toolAccess = Array.isArray(meta.tool_access)
        ? (meta.tool_access as string[]).filter((s): s is string => typeof s === "string")
        : [];
    const blockedTools = Array.isArray(meta.blocked_tools)
        ? (meta.blocked_tools as string[]).filter((s): s is string => typeof s === "string")
        : [];
    return { role, toolAccess, blockedTools };
}

export function isAdmin(user: HasAppMetadata | null | undefined): boolean {
    return userAccess(user).role === "admin";
}

/** Admins implicitly get every tool. */
export function canAccessTool(access: UserAccess, slug: string): boolean {
    return access.role === "admin" || access.toolAccess.includes(slug);
}

/**
 * Merge the team-wide public tool set into a user's access label.
 * Public tools bypass individual grants unless the user is blocked from them —
 * blocked tools are removed from the effective set (block overrides everything).
 */
export function mergeToolAccess(access: UserAccess, publicTools: string[]): UserAccess {
    const effective = new Set([...access.toolAccess, ...publicTools]);
    for (const blocked of access.blockedTools ?? []) {
        effective.delete(blocked);
    }
    return {
        ...access,
        toolAccess: [...effective],
    };
}

export function toolBySlug(slug: string): ToolDef | undefined {
    return TOOLS.find((t) => t.slug === slug);
}