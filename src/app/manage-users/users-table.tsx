"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TOOLS, type AdminUser } from "@/lib/access";
import { toggleToolAccess, toggleBlockedTool, banUserFromPlatform, unbanUserFromPlatform, unbanUserWithTools } from "./actions";
import {
    HiOutlineExclamation,
    HiOutlineCheck,
    HiOutlineX,
    HiOutlineSearch,
    HiOutlineBan,
    HiChevronDown,
    HiOutlineFilter,
} from "react-icons/hi";

/** Titles come from the single source of truth in `@/lib/access`. */
const TOOL_LABELS: Record<string, string> = Object.fromEntries(
    TOOLS.map((t) => [t.slug, t.title])
);

function initials(name: string | null, email: string | null): string {
    const source = name?.trim() || email?.trim() || "?";
    return source
        .split(/[\s@.]+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((p) => p[0]?.toUpperCase() ?? "")
        .join("");
}

export default function UsersTable({ users, publicTools = [] }: { users: AdminUser[]; publicTools: string[] }) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);
    const [query, setQuery] = useState("");
    const [filterSlugs, setFilterSlugs] = useState<string[]>([]);
    const [draftFilters, setDraftFilters] = useState<string[]>([]);
    const [activeTab, setActiveTab] = useState<"active" | "banned">("active");
    const [pending, setPending] = useState<{
        user: AdminUser;
        slug: string;
        granted: boolean;
    } | null>(null);
    const [pendingBlock, setPendingBlock] = useState<{
        user: AdminUser;
        slug: string;
        blocked: boolean;
    } | null>(null);
    const [pendingPlatformBan, setPendingPlatformBan] = useState<{
        user: AdminUser;
        banned: boolean;
        grantedTools: string[];
        blockedTools: string[];
    } | null>(null);
    const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
    const [filterOpen, setFilterOpen] = useState(false);

    const toggleSection = (key: string) =>
        setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));

    const run = (action: () => Promise<unknown>) => {
        setError(null);
        startTransition(async () => {
            try {
                await action();
                router.refresh();
            } catch (e) {
                setError(e instanceof Error ? e.message : "Something went wrong.");
            }
        });
    };

    const confirmToggle = () => {
        if (!pending) return;
        const { user, slug, granted } = pending;
        setPending(null);
        run(() => toggleToolAccess(user.id, slug, granted));
    };

    const confirmBlockToggle = () => {
        if (!pendingBlock) return;
        const { user, slug } = pendingBlock;
        setPendingBlock(null);
        run(() => toggleBlockedTool(user.id, slug));
    };

    const confirmPlatformBan = () => {
        if (!pendingPlatformBan) return;
        const { user, banned, grantedTools, blockedTools } = pendingPlatformBan;
        setPendingPlatformBan(null);
        if (banned) {
            run(() => unbanUserWithTools(user.id, grantedTools, blockedTools));
        } else {
            run(() => banUserFromPlatform(user.id));
        }
    };

    const q = query.trim().toLowerCase();
    const filtered = users.filter((u) => {
        const matchesQuery =
            !q ||
            u.displayName?.toLowerCase().includes(q) ||
            u.email?.toLowerCase().includes(q) ||
            false;
        const matchesTool =
            filterSlugs.length === 0 ||
            filterSlugs.some(
                (slug) =>
                    u.toolAccess.includes(slug) ||
                    (publicTools.includes(slug) && !u.blockedTools.includes(slug))
            );
        return matchesQuery && matchesTool;
    });

    const activeUsers = filtered.filter((u) => !u.banned);
    const bannedUsers = filtered.filter((u) => u.banned);

    // While narrowing, the tabs are hidden and every match is shown regardless of
    // ban status, so searching for a user always surfaces them either way.
    const isNarrowing = q !== "" || filterSlugs.length > 0;
    const visibleUsers = isNarrowing
        ? filtered
        : activeTab === "banned"
            ? bannedUsers
            : activeUsers;

    return (
        <div className="mt-6 flex flex-col gap-4">
            {error && (
                <div className="flex items-center gap-3 rounded-[0.8em] border border-red-400/40 bg-red-500/10 px-2.5 py-2.5 text-sm text-red-500 dark:border-red-400/30 dark:bg-red-500/15 dark:text-red-400">
                    <span className="flex shrink-0 items-center justify-center rounded-[0.4em] bg-red-500/20 p-2 dark:bg-red-400/20">
                        <HiOutlineExclamation size={16} />
                    </span>
                    <span>{error}</span>
                </div>
            )}

            {isPending && <p className="text-xs text-muted-foreground">Saving…</p>}

            {/* Search + tool filter */}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <label className="relative flex flex-1 items-center">
                    <HiOutlineSearch
                        size={15}
                        className="pointer-events-none absolute left-3 text-muted-foreground"
                    />
                    <input
                        type="search"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search by name or email…"
                        className="w-full rounded-[0.6em] border border-border bg-card px-3 py-2 pl-9 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none"
                    />
                </label>
                <button
                    type="button"
                    onClick={() => {
                        setDraftFilters(filterSlugs);
                        setFilterOpen(true);
                    }}
                    className="flex cursor-pointer items-center gap-2 rounded-[0.6em] border border-border bg-card px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
                >
                    <HiOutlineFilter size={15} className="text-muted-foreground" />
                    Filter
                    {filterSlugs.length > 0 && (
                        <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[0.65rem] font-semibold text-primary-foreground">
                            {filterSlugs.length}
                        </span>
                    )}
                </button>
            </div>

            {/* Active / Banned tabs — hidden while searching or filtering */}
            {!isNarrowing && (
                <div className="flex gap-1 rounded-[0.7em] border border-border bg-card p-1">
                {(
                    [
                        { key: "active", label: "Active Users", count: activeUsers.length },
                        { key: "banned", label: "Banned Users", count: bannedUsers.length },
                    ] as const
                ).map((tab) => {
                    const selected = activeTab === tab.key;
                    return (
                        <button
                            key={tab.key}
                            type="button"
                            onClick={() => setActiveTab(tab.key)}
                            className={`flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-[0.5em] px-3 py-2 text-sm font-medium transition-colors ${
                                selected
                                    ? tab.key === "banned"
                                        ? "bg-red-500/10 text-red-600 dark:text-red-400"
                                        : "bg-muted text-foreground"
                                    : "text-muted-foreground hover:bg-muted/50"
                            }`}
                        >
                            {tab.label}
                            <span
                                className={`flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[0.7rem] font-semibold ${
                                    selected
                                        ? tab.key === "banned"
                                            ? "bg-red-500/20 text-red-600 dark:text-red-400"
                                            : "bg-foreground/10 text-foreground"
                                        : "bg-muted text-muted-foreground"
                                }`}
                            >
                                {tab.count}
                            </span>
                        </button>
                    );
                })}
                </div>
            )}

            {/* Tool filter modal */}
            {filterOpen && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
                    onClick={() => setFilterOpen(false)}
                >
                    <div
                        className="w-full max-w-md rounded-[0.8em] border border-border bg-card p-6 shadow-lg"
                        onClick={(e) => e.stopPropagation()}
                        role="dialog"
                        aria-modal="true"
                    >
                        <div className="flex items-center justify-between gap-3">
                            <h2 className="text-base font-semibold text-foreground">Filter users</h2>
                            <button
                                type="button"
                                onClick={() => setFilterOpen(false)}
                                aria-label="Close"
                                className="cursor-pointer rounded-[0.5em] border border-border bg-background p-1.5 text-foreground transition-colors hover:bg-muted"
                            >
                                <HiOutlineX size={14} />
                            </button>
                        </div>

                        <p className="mt-1 text-xs text-muted-foreground">
                            Select one or more tools. Users matching any selected tool are shown.
                        </p>

                        <div className="mt-4 max-h-72 space-y-2 overflow-y-auto pr-1">
                            {TOOLS.map((t) => {
                                const checked = draftFilters.includes(t.slug);
                                return (
                                    <label
                                        key={t.slug}
                                        className={`relative flex cursor-pointer items-center gap-3 rounded-[0.6em] border px-3 py-2.5 transition-colors ${
                                            checked
                                                ? "border-primary/40 bg-primary/10"
                                                : "border-border bg-background hover:bg-muted"
                                        }`}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={checked}
                                            onChange={(e) =>
                                                setDraftFilters((prev) =>
                                                    e.target.checked
                                                        ? [...prev, t.slug]
                                                        : prev.filter((s) => s !== t.slug)
                                                )
                                            }
                                            className="pointer-events-none absolute opacity-0 w-5 h-5"
                                        />
                                        <span
                                            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-[0.4em] border-2 transition-all ${
                                                checked
                                                    ? "border-primary bg-primary text-primary-foreground"
                                                    : "border-border bg-background"
                                            }`}
                                        >
                                            {checked && (
                                                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                                </svg>
                                            )}
                                        </span>
                                        <span className="text-sm font-medium text-foreground">
                                            {TOOL_LABELS[t.slug] ?? t.slug}
                                        </span>
                                    </label>
                                );
                            })}
                        </div>

                        <div className="mt-5 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setDraftFilters([])}
                                className="cursor-pointer rounded-[0.6em] border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                            >
                                Clear
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setFilterSlugs(draftFilters);
                                    setFilterOpen(false);
                                }}
                                className="cursor-pointer rounded-[0.6em] border border-blue-500/30 bg-blue-500/10 px-6 py-2 text-sm font-medium text-blue-600 transition-colors hover:bg-blue-500/15 dark:text-blue-400"
                            >
                                Done
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {visibleUsers.length === 0 && (
                <p className="rounded-[0.8em] border border-border bg-card p-6 text-center text-sm text-muted-foreground">
                    {users.length === 0
                        ? "No users found."
                        : isNarrowing
                            ? "No users match your search or filter."
                            : activeTab === "banned"
                                ? "No banned users."
                                : "No active users."}
                </p>
            )}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {visibleUsers.map((u) => {
                    return (
                        <div
                            key={u.id}
                            className={`rounded-[0.8em] border border-border bg-card p-4 shadow-sm ${u.banned ? "border-red-400/40 bg-red-500/5" : ""}`}
                        >
                            <div className="flex items-center justify-between gap-3">
                                <div className="flex min-w-0 items-center gap-3">
                                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                                        {initials(u.displayName, u.email)}
                                    </span>
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-medium text-foreground">
                                            {u.displayName ?? "No name"}
                                        </p>
                                        <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                                    </div>
                                </div>

                                <div className="ml-auto flex shrink-0 items-center gap-2">
                                      {/* Platform ban CTA */}
{u.banned ? (
                                          u.role !== "admin" && (
                                              <button
                                                  type="button"
                                                  disabled={isPending}
                                                  onClick={() => setPendingPlatformBan({
                                                      user: u,
                                                      banned: true,
                                                      grantedTools: [],
                                                      blockedTools: u.blockedTools,
                                                  })}
                                                  className="flex cursor-pointer items-center gap-1.5 rounded-[0.6em] border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-500/15 dark:text-red-400 disabled:opacity-50"
                                              >
                                                  <HiOutlineCheck size={12} />
                                                  Unban User
                                              </button>
                                          )
                                      ) : (
                                          u.role !== "admin" && (
                                              <button
                                                  type="button"
                                                  disabled={isPending}
                                                  onClick={() => setPendingPlatformBan({
                                                      user: u,
                                                      banned: false,
                                                      grantedTools: [],
                                                      blockedTools: [],
                                                  })}
                                                  className="flex cursor-pointer items-center gap-1.5 rounded-[0.6em] border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-500/15 dark:text-red-400 disabled:opacity-50"
                                              >
                                                  <HiOutlineBan size={12} />
                                                  Ban User
                                              </button>
                                          )
                                      )}
                                 </div>
                            </div>

                            {!u.banned && (
                                <>
                                    {/* Public Tools Access Accordion */}
                                    <div className="mt-4 overflow-hidden rounded-[0.8em] border border-border bg-card">
                                        <button
                                            type="button"
                                            onClick={() => toggleSection(`${u.id}-public`)}
                                            className="flex w-full cursor-pointer items-center justify-between gap-2 p-4 text-left transition-colors hover:bg-muted/50"
                                        >
                                            <span className="text-sm font-semibold text-foreground">Public Tools Access</span>
                                            <span className="flex items-center gap-2">
                                                <span className="text-xs text-muted-foreground">
                                                    {publicTools.filter(s => !u.blockedTools.includes(s)).length} / {publicTools.length} enabled
                                                </span>
                                                <HiChevronDown
                                                    size={16}
                                                    className={`text-muted-foreground transition-transform ${openSections[`${u.id}-public`] ? "rotate-180" : ""}`}
                                                />
                                            </span>
                                        </button>
                                        {openSections[`${u.id}-public`] && (
                                            <div className="border-t border-border p-4">
                                                <p className="mb-3 text-xs text-muted-foreground">
                                                    Granted to every user by default. Use Blocked Tools to remove access.
                                                </p>
                                                <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                                                    {TOOLS.filter(t => publicTools.includes(t.slug)).map((t) => {
                                                        const blocked = u.blockedTools.includes(t.slug);
                                                        return (
                                                            <span
                                                                key={t.slug}
                                                                className={`flex items-center justify-center gap-1.5 rounded-[0.6em] border px-3 py-2 text-xs font-medium ${
                                                                    blocked
                                                                        ? "border-border bg-muted/40 text-muted-foreground line-through"
                                                                        : "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                                                }`}
                                                            >
                                                                {blocked ? <HiOutlineBan size={12} /> : <HiOutlineCheck size={12} />}
                                                                <span className="truncate">{TOOL_LABELS[t.slug] ?? t.slug}</span>
                                                            </span>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Private Tools Accordion */}
                                    <div className="mt-3 overflow-hidden rounded-[0.8em] border border-border bg-card">
                                        <button
                                            type="button"
                                            onClick={() => toggleSection(`${u.id}-private`)}
                                            className="flex w-full cursor-pointer items-center justify-between gap-2 p-4 text-left transition-colors hover:bg-muted/50"
                                        >
                                            <span className="text-sm font-semibold text-foreground">Private Tools</span>
                                            <span className="flex items-center gap-2">
                                                <span className="text-xs text-muted-foreground">
                                                    {TOOLS.filter(t => !publicTools.includes(t.slug) && u.toolAccess.includes(t.slug)).length} / {TOOLS.filter(t => !publicTools.includes(t.slug)).length} enabled
                                                </span>
                                                <HiChevronDown
                                                    size={16}
                                                    className={`text-muted-foreground transition-transform ${openSections[`${u.id}-private`] ? "rotate-180" : ""}`}
                                                />
                                            </span>
                                        </button>
                                        {openSections[`${u.id}-private`] && (
                                            <div className="grid grid-cols-2 gap-2 border-t border-border p-4 md:grid-cols-3">
                                                {TOOLS.filter(t => !publicTools.includes(t.slug)).map((t) => {
                                                    const granted = u.toolAccess.includes(t.slug);
                                                    return (
                                                        <button
                                                            key={t.slug}
                                                            type="button"
                                                            disabled={isPending}
                                                            onClick={() => setPending({ user: u, slug: t.slug, granted })}
                                                            className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-[0.6em] border px-3 py-2 text-xs font-medium transition-colors disabled:opacity-50 ${
                                                                granted
                                                                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                                                    : "border-border text-muted-foreground hover:bg-muted"
                                                            }`}
                                                        >
                                                            {granted ? <HiOutlineCheck size={12} /> : <HiOutlineX size={12} />}
                                                            <span className="truncate">{TOOL_LABELS[t.slug] ?? t.slug}</span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>

                                    {/* Blocked Tools Accordion */}
                                    <div className="mt-3 overflow-hidden rounded-[0.8em] border border-border bg-card">
                                        <button
                                            type="button"
                                            onClick={() => toggleSection(`${u.id}-blocked`)}
                                            className="flex w-full cursor-pointer items-center justify-between gap-2 p-4 text-left transition-colors hover:bg-muted/50"
                                        >
                                            <span className="text-sm font-semibold text-foreground">Blocked Tools</span>
                                            <span className="flex items-center gap-2">
                                                <span className="text-xs text-muted-foreground">
                                                    {u.blockedTools.length} blocked
                                                </span>
                                                <HiChevronDown
                                                    size={16}
                                                    className={`text-muted-foreground transition-transform ${openSections[`${u.id}-blocked`] ? "rotate-180" : ""}`}
                                                />
                                            </span>
                                        </button>
                                        {openSections[`${u.id}-blocked`] && (
                                            <div className="grid grid-cols-2 gap-2 border-t border-border p-4 md:grid-cols-3">
                                                {TOOLS.map((t) => {
                                                    const blocked = u.blockedTools.includes(t.slug);
                                                    return (
                                                        <button
                                                            key={t.slug}
                                                            type="button"
                                                            disabled={isPending}
                                                            onClick={() => setPendingBlock({ user: u, slug: t.slug, blocked })}
                                                            title={blocked ? "Click to restore access" : "Click to block access"}
                                                            className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-[0.6em] border px-3 py-2 text-xs font-medium transition-colors disabled:opacity-50 ${
                                                                blocked
                                                                    ? "border-red-500/40 bg-red-500/10 text-red-600 dark:border-red-400/30 dark:text-red-400"
                                                                    : "border-border text-muted-foreground hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-500"
                                                            }`}
                                                        >
                                                            <HiOutlineBan size={12} />
                                                            <span className="truncate">{TOOL_LABELS[t.slug] ?? t.slug}</span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Per-user grant confirmation modal */}
            {pending && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
                    onClick={() => setPending(null)}
                >
                    <div
                        className="w-full max-w-md rounded-[0.8em] border border-border bg-card p-6 shadow-lg"
                        onClick={(e) => e.stopPropagation()}
                        role="dialog"
                        aria-modal="true"
                    >
                        <div className="flex items-center gap-2.5">
                            <span
                                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[0.6em] ${
                                    pending.granted
                                        ? "bg-red-500/15 text-red-500 dark:text-red-400"
                                        : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                                }`}
                            >
                                {pending.granted ? <HiOutlineX size={18} /> : <HiOutlineCheck size={18} />}
                            </span>
                            <h2 className="text-base font-semibold text-foreground">
                                {pending.granted ? "Revoke" : "Grant"}{" "}
                                {TOOL_LABELS[pending.slug] ?? pending.slug}
                            </h2>
                        </div>

                        <p className="mt-3 text-sm text-foreground">
                            {pending.granted ? (
                                <>
                                    You are about to <strong>revoke</strong>{" "}
                                    {TOOL_LABELS[pending.slug] ?? pending.slug} from{" "}
                                    <strong>{pending.user.displayName ?? pending.user.email}</strong>.
                                    They will lose the tool from their dashboard immediately.
                                </>
                            ) : (
                                <>
                                    You are about to <strong>grant</strong>{" "}
                                    {TOOL_LABELS[pending.slug] ?? pending.slug} to{" "}
                                    <strong>{pending.user.displayName ?? pending.user.email}</strong>.
                                    The tool will appear on their dashboard on next load.
                                </>
                            )}
                        </p>

                        <div className="mt-5 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setPending(null)}
                                disabled={isPending}
                                className="cursor-pointer rounded-[0.6em] border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={confirmToggle}
                                disabled={isPending}
                                className={`cursor-pointer w-full md:w-auto rounded-[0.6em] border px-8 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
                                    pending.granted
                                        ? "border-red-500/30 bg-red-500/10 text-red-600 hover:bg-red-500/15 dark:text-red-400"
                                        : "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/15 dark:text-emerald-400"
                                }`}
                            >
                                {isPending ? "Saving…" : pending.granted ? "Revoke" : "Grant"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Per-user block confirmation modal */}
            {pendingBlock && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
                    onClick={() => setPendingBlock(null)}
                >
                    <div
                        className="w-full max-w-md rounded-[0.8em] border border-border bg-card p-6 shadow-lg"
                        onClick={(e) => e.stopPropagation()}
                        role="dialog"
                        aria-modal="true"
                    >
                        <div className="flex items-center gap-2.5">
                            <span
                                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[0.6em] ${
                                    pendingBlock.blocked
                                        ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                                        : "bg-red-500/15 text-red-500 dark:text-red-400"
                                }`}
                            >
                                <HiOutlineBan size={18} />
                            </span>
                            <h2 className="text-base font-semibold text-foreground">
                                {pendingBlock.blocked ? "Unblock" : "Block"}{" "}
                                {TOOL_LABELS[pendingBlock.slug] ?? pendingBlock.slug}
                            </h2>
                        </div>

                        <p className="mt-3 text-sm text-foreground">
                            {pendingBlock.blocked ? (
                                <>
                                    You are about to <strong>unban</strong>{" "}
                                    {pendingBlock.user.displayName ?? pendingBlock.user.email} from{" "}
                                    <strong>{TOOL_LABELS[pendingBlock.slug] ?? pendingBlock.slug}</strong>.
                                    They regain access if the tool is granted or public.
                                </>
                            ) : (
                                <>
                                    You are about to <strong>ban</strong>{" "}
                                    {pendingBlock.user.displayName ?? pendingBlock.user.email} from{" "}
                                    <strong>{TOOL_LABELS[pendingBlock.slug] ?? pendingBlock.slug}</strong>.
                                    A ban overrides public access and any individual grant — the tool
                                    disappears from their dashboard immediately.
                                </>
                            )}
                        </p>

                        <div className="mt-5 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setPendingBlock(null)}
                                disabled={isPending}
                                className="cursor-pointer rounded-[0.6em] border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={confirmBlockToggle}
                                disabled={isPending}
                                className={`cursor-pointer w-full md:w-auto rounded-[0.6em] border px-8 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
                                    pendingBlock.blocked
                                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/15 dark:text-emerald-400"
                                        : "border-red-500/30 bg-red-500/10 text-red-600 hover:bg-red-500/15 dark:text-red-400"
                                }`}
                            >
                                {isPending ? "Saving…" : pendingBlock.blocked ? "Unblock" : "Block"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Per-user platform ban confirmation modal */}
            {pendingPlatformBan && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
                    onClick={() => setPendingPlatformBan(null)}
                >
                    <div
                        className="w-full max-w-md rounded-[0.8em] border border-border bg-card p-6 shadow-lg"
                        onClick={(e) => e.stopPropagation()}
                        role="dialog"
                        aria-modal="true"
                    >
                        <div className="flex items-center gap-2.5">
                            <span
                                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[0.6em] ${
                                    pendingPlatformBan.banned
                                        ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                                        : "bg-red-500/15 text-red-500 dark:text-red-400"
                                }`}
                            >
                                {pendingPlatformBan.banned ? <HiOutlineCheck size={18} /> : <HiOutlineBan size={18} />}
                            </span>
                            <h2 className="text-base font-semibold text-foreground">
                                {pendingPlatformBan.banned ? "Unban from Platform" : "Ban from Platform"}
                            </h2>
                        </div>

{pendingPlatformBan.banned ? (
                            <>
                                <p className="mt-3 text-sm text-foreground">
                                    You are about to <strong>unban</strong>{" "}
                                    <strong>{pendingPlatformBan.user.displayName ?? pendingPlatformBan.user.email}</strong> from the platform.
                                </p>

                                {publicTools.length > 0 && (
                                    <div className="mt-4 rounded-[0.8em] border border-border bg-card p-4">
                                        <h3 className="text-sm font-semibold text-foreground mb-2">
                                            Public Tools Access
                                        </h3>
                                        <p className="text-xs text-muted-foreground mb-3">
                                            All public tools are enabled by default. Uncheck to block access for this user.
                                        </p>
                                        <div className="space-y-2">
                                            {publicTools.map((slug) => {
                                                // Public tools are granted implicitly, so "enabled" simply
                                                // means "not blocked". The server drops these from tool_access.
                                                const isBlocked = pendingPlatformBan.blockedTools.includes(slug);
                                                const isEnabled = !isBlocked;
                                                return (
                                                    <label
                                                        key={slug}
                                                        className="flex items-center justify-between gap-3 rounded-[0.6em] border border-border bg-background px-3 py-2.5 cursor-pointer hover:bg-muted/50 transition-colors"
                                                    >
                                                        <div className="flex items-center gap-3">
                                                            <div className="relative">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={isEnabled}
                                                                    onChange={(e) => {
                                                                        const newBlocked = e.target.checked
                                                                            ? pendingPlatformBan.blockedTools.filter((s) => s !== slug)
                                                                            : [...pendingPlatformBan.blockedTools, slug];
                                                                        setPendingPlatformBan({
                                                                            ...pendingPlatformBan,
                                                                            blockedTools: newBlocked,
                                                                        });
                                                                    }}
                                                                    className="absolute opacity-0 pointer-events-none w-5 h-5"
                                                                />
                                                                <div className={`w-5 h-5 rounded-[0.4em] border-2 flex items-center justify-center transition-all ${
                                                                    isEnabled
                                                                        ? "bg-foreground border-foreground text-background"
                                                                        : "border-border bg-background"
                                                                }`}>
                                                                    {isEnabled && (
                                                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                                                        </svg>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            <span className="text-sm font-medium text-foreground">
                                                                {TOOL_LABELS[slug] ?? slug}
                                                            </span>
                                                        </div>
                                                        {isBlocked && (
                                                            <span className="flex items-center gap-1.5 rounded-[0.4em] bg-red-500/10 px-2.5 py-1 text-[0.65rem] font-medium text-red-500 dark:bg-red-500/20 dark:text-red-400">
                                                                <span className="relative flex h-1.5 w-1.5 rounded-full bg-red-500" />
                                                                Banned from tool
                                                            </span>
                                                        )}
                                                    </label>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </>
                        ) : (
                            <>
                                <p className="mt-3 text-sm text-foreground">
                                    You are about to <strong>ban</strong>{" "}
                                    <strong>{pendingPlatformBan.user.displayName ?? pendingPlatformBan.user.email}</strong> from the entire platform.
                                    They will be unable to sign in or access any tools until unbanned.
                                </p>
                            </>
                        )}

                        <div className="mt-5 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setPendingPlatformBan(null)}
                                disabled={isPending}
                                className="cursor-pointer rounded-[0.6em] border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={confirmPlatformBan}
                                disabled={isPending}
                                className="cursor-pointer w-full md:w-auto rounded-[0.6em] border border-red-500/30 bg-red-500/10 px-8 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-500/15 disabled:opacity-50 dark:text-red-400"
                            >
                                {isPending ? "Saving…" : pendingPlatformBan.banned ? "Unban" : "Ban"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}