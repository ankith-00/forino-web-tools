"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TOOLS, type AdminUser } from "@/lib/access";
import { toggleToolAccess, toggleBlockedTool } from "./actions";
import {
    HiOutlineShieldCheck,
    HiOutlineUser,
    HiOutlineExclamation,
    HiOutlineCheck,
    HiOutlineX,
    HiOutlineSearch,
    HiOutlineBan,
} from "react-icons/hi";

const TOOL_LABELS: Record<string, string> = {
    scanner: "Barcode Scanner",
    barcode: "Barcode Marker",
    "id-card": "ID Card Maker",
};

function initials(name: string | null, email: string | null): string {
    const source = name?.trim() || email?.trim() || "?";
    return source
        .split(/[\s@.]+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((p) => p[0]?.toUpperCase() ?? "")
        .join("");
}

export default function UsersTable({ users }: { users: AdminUser[] }) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);
    const [query, setQuery] = useState("");
    const [filterSlug, setFilterSlug] = useState("all");
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
        run(() => toggleToolAccess(user.id, slug, !granted));
    };

    const confirmBlockToggle = () => {
        if (!pendingBlock) return;
        const { user, slug } = pendingBlock;
        setPendingBlock(null);
        run(() => toggleBlockedTool(user.id, slug));
    };

    const q = query.trim().toLowerCase();
    const filtered = users.filter((u) => {
        const matchesQuery =
            !q ||
            u.displayName?.toLowerCase().includes(q) ||
            u.email?.toLowerCase().includes(q) ||
            false;
        const matchesTool = filterSlug === "all" || u.toolAccess.includes(filterSlug);
        return matchesQuery && matchesTool;
    });

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
                <select
                    value={filterSlug}
                    onChange={(e) => setFilterSlug(e.target.value)}
                    className="rounded-[0.6em] border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none"
                >
                    <option value="all">All tools</option>
                    {TOOLS.map((t) => (
                        <option key={t.slug} value={t.slug}>
                            Has {TOOL_LABELS[t.slug] ?? t.slug}
                        </option>
                    ))}
                </select>
            </div>

            {filtered.length === 0 && (
                <p className="rounded-[0.8em] border border-border bg-card p-6 text-center text-sm text-muted-foreground">
                    {users.length === 0 ? "No users found." : "No users match your search or filter."}
                </p>
            )}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {filtered.map((u) => {
                    return (
                        <div
                            key={u.id}
                            className="rounded-[0.8em] border border-border bg-card p-4 shadow-sm"
                        >
                            <div className="flex flex-wrap items-center justify-between gap-3">
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

                                {/* Role pill (static) */}
                                <span
                                    className={`flex items-center gap-1.5 rounded-[0.6em] border px-3 py-1.5 text-xs font-medium ${
                                        u.role === "admin"
                                            ? "border-primary/30 bg-primary/10 text-primary"
                                            : "border-border text-muted-foreground"
                                    }`}
                                >
                                    {u.role === "admin" ? (
                                        <HiOutlineShieldCheck size={14} />
                                    ) : (
                                        <HiOutlineUser size={14} />
                                    )}
                                    {u.role === "admin" ? "Admin" : "User"}
                                </span>
                            </div>

                            {/* Tool pills — click to grant/revoke via confirmation modal */}
                            <div className="mt-4 flex flex-wrap gap-2">
                                {TOOLS.map((t) => {
                                    const granted = u.toolAccess.includes(t.slug);
                                    return (
                                        <button
                                            key={t.slug}
                                            type="button"
                                            disabled={isPending}
                                            onClick={() => setPending({ user: u, slug: t.slug, granted })}
                                            className={`flex cursor-pointer items-center gap-1.5 rounded-[0.6em] border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                                                granted
                                                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                                    : "border-border text-muted-foreground hover:bg-muted"
                                            }`}
                                        >
                                            {granted ? <HiOutlineCheck size={13} /> : <HiOutlineX size={13} />}
                                            {TOOL_LABELS[t.slug] ?? t.slug}
                                        </button>
                                    );
                                })}
                            </div>

                            {/* Block chips — hard ban that overrides public + granted access */}
                            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                                <span className="text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground">
                                    Banned from
                                </span>
                                {TOOLS.map((t) => {
                                    const blocked = u.blockedTools.includes(t.slug);
                                    return (
                                        <button
                                            key={t.slug}
                                            type="button"
                                            disabled={isPending}
                                            onClick={() => setPendingBlock({ user: u, slug: t.slug, blocked })}
                                            className={`flex cursor-pointer items-center gap-1.5 rounded-[0.55em] border px-2.5 py-1 text-[0.7rem] font-medium transition-colors disabled:opacity-50 ${
                                                blocked
                                                    ? "border-red-500/40 bg-red-500/15 text-red-500 dark:border-red-400/30 dark:bg-red-500/20 dark:text-red-400"
                                                    : "border-border text-muted-foreground hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-500"
                                            }`}
                                        >
                                            <HiOutlineBan size={12} />
                                            {TOOL_LABELS[t.slug] ?? t.slug}
                                        </button>
                                    );
                                })}
                            </div>
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
                                {pending.granted ? "Revoke access" : "Grant access"}
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
                                className="cursor-pointer rounded-[0.6em] border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={confirmToggle}
                                disabled={isPending}
                                className={`cursor-pointer rounded-[0.6em] px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50 ${
                                    pending.granted
                                        ? "bg-red-500 hover:bg-red-600"
                                        : "bg-emerald-600 hover:bg-emerald-700"
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
                                {pendingBlock.blocked ? "Unban user" : "Ban user"}
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
                                className="cursor-pointer rounded-[0.6em] border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={confirmBlockToggle}
                                disabled={isPending}
                                className={`cursor-pointer rounded-[0.6em] px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50 ${
                                    pendingBlock.blocked
                                        ? "bg-emerald-600 hover:bg-emerald-700"
                                        : "bg-red-500 hover:bg-red-600"
                                }`}
                            >
                                {isPending ? "Saving…" : pendingBlock.blocked ? "Unban" : "Ban"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}