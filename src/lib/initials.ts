/**
 * Two-letter avatar initials, shared by the user cards and the invite cards so
 * a person looks the same in either tab. Safe to import from a client component.
 */
export function initials(name: string | null, email: string | null): string {
    const source = name?.trim() || email?.trim() || "?";
    return source
        .split(/[\s@.]+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((p) => p[0]?.toUpperCase() ?? "")
        .join("");
}
