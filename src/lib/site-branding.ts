/**
 * Per-user app branding: the site title and footer note an admin sets on an
 * individual account from the "Site configuration" row in the user card.
 *
 * Pure and dependency-free so the proxy, server components and client components
 * can all import it (same rule as `@/lib/access`). The values live in the user's
 * `app_metadata` next to `tool_access` and `blocked_tools`, so there is no table
 * to migrate and no join to get wrong.
 *
 * The important subtlety is that a brand is *optional*. An unset brand must fall
 * back to the platform default, which is a credit line carrying a real link to
 * ankith.dev — whereas a brand the admin actually set is rendered as inert plain
 * text. So "no value" and "empty value" cannot collapse into the same thing, and
 * a blank submission has to mean "revert to the default" rather than "show
 * nothing".
 */

/**
 * The wordmark shown when a user has not configured their own.
 *
 * "Web tools" rather than the product name: the header is describing what the
 * page is, and the platform name already appears in the legal copy and the
 * transactional emails, which are written as prose and are not admin-editable.
 */
export const DEFAULT_SITE_TITLE = "UTIL HUB";

/** The link the default footer credits. Kept here so the markup cannot drift from it. */
export const AUTHOR_URL = "https://www.ankith.dev";

/** Kept in step with the maxLength on the inputs in the user card. */
export const BRANDING_LIMITS = {
    siteTitle: 80,
    footerNote: 160,
} as const;

export interface UserBranding {
    /**
     * `null` means "never configured", which renders the platform default. An
     * empty string is never stored, so `null` is the only unset state.
     */
    siteTitle: string | null;
    footerNote: string | null;
}

export const DEFAULT_BRANDING: UserBranding = {
    siteTitle: null,
    footerNote: null,
};

/** Metadata shape this module reads. Matches Supabase's user object. */
interface HasAppMetadata {
    app_metadata?: unknown;
}

/**
 * Normalise one field. Returns `null` for anything that is not a usable string,
 * which routes the reader to the platform default rather than to a blank header.
 */
function readField(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
}

/**
 * Read a user's brand out of their `app_metadata`.
 *
 * Unknown keys, nulls and empty strings all resolve to "not configured", so a row
 * hand-edited in the Supabase dashboard cannot leave a user with an empty header.
 */
export function userBranding(user: HasAppMetadata | null | undefined): UserBranding {
    const meta = (user?.app_metadata ?? {}) as Record<string, unknown>;

    return {
        siteTitle: readField(meta.site_title),
        footerNote: readField(meta.footer_note),
    };
}

/** The title to render for a user: their own if set, otherwise the platform default. */
export function resolveSiteTitle(branding: UserBranding): string {
    return branding.siteTitle ?? DEFAULT_SITE_TITLE;
}

/**
 * Whether the footer should render the default credit line (with its link) or the
 * admin's own plain text.
 *
 * This is a separate question from `resolveSiteTitle` because the two behave
 * differently on purpose: a custom title is still just a title, but a custom
 * footer deliberately drops the author link so admin-authored text is never mixed
 * with it.
 */
export function usesDefaultFooter(branding: UserBranding): boolean {
    return branding.footerNote === null;
}

/**
 * Clean the admin's input into what will actually be stored.
 *
 * A blank field becomes `null`, which is the "revert to default" instruction — the
 * alternative would be storing "" and rendering a header with no name or a footer
 * with no credit line at all.
 */
export function normaliseBranding(input: { siteTitle: string; footerNote: string }): UserBranding {
    return {
        siteTitle: clamp(input.siteTitle, BRANDING_LIMITS.siteTitle),
        footerNote: clamp(input.footerNote, BRANDING_LIMITS.footerNote),
    };
}

function clamp(value: string, maxLength: number): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (trimmed === "") return null;
    return trimmed.slice(0, maxLength);
}

/** True when two brands would render identically. */
export function brandingEqual(a: UserBranding, b: UserBranding): boolean {
    return a.siteTitle === b.siteTitle && a.footerNote === b.footerNote;
}

/**
 * The `app_metadata` keys this feature owns.
 *
 * The write path merges rather than replacing `app_metadata` wholesale, so a bug
 * here can never drop `role`, `tool_access` or `blocked_tools`. These two keys are
 * the only ones an admin is allowed to set.
 */
export const BRANDING_METADATA_KEYS = ["site_title", "footer_note"] as const;