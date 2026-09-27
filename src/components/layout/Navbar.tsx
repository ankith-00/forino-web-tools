"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { useTheme } from "@/components/theme/theme-provider";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { TOOLS, canAccessTool, isAdmin, userAccess, mergeToolAccess } from "@/lib/access";
import { toolIcon } from "@/lib/tool-icons";
import { Blobatar } from "@blobatar/react";
import "blobatar/motion.css";
import {
    HiOutlineChevronRight,
    HiOutlineLogout,
    HiOutlineViewGrid,
    HiOutlineSun,
    HiOutlineMoon,
    HiOutlineShieldCheck,
} from "react-icons/hi";

type UserInfo = {
    email: string;
    display_name: string | null;
    avatar_url: string | null;
};

// Deterministic scramble of a string into a compact stable seed.
function hashSeed(value: string): string {
    let h = 5381;
    for (let i = 0; i < value.length; i++) h = ((h * 33) ^ value.charCodeAt(i)) >>> 0;
    return `u${h.toString(36)}`;
}

export default function Navbar() {
    const router = useRouter();
    const supabase = createClient();
    const { resolvedTheme, setTheme } = useTheme();

    const [user, setUser] = useState<UserInfo | null>(null);
    const [admin, setAdmin] = useState(false);
    const [toolAccess, setToolAccess] = useState<string[]>([]);
    const [avatarOpen, setAvatarOpen] = useState(false);
    const [toolsOpen, setToolsOpen] = useState(false);

    const avatarRef = useRef<HTMLDivElement>(null);

    const refreshAccess = useCallback(async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            setUser(null);
            setAdmin(false);
            setToolAccess([]);
            return;
        }
        const access = userAccess(user);
        setUser({
            email: user.email ?? "",
            display_name: user.user_metadata?.display_name ?? null,
            avatar_url: user.user_metadata?.avatar_url ?? null,
        });
        setAdmin(isAdmin(user));
        const { data } = await supabase.from("tool_settings").select("slug").eq("is_public", true);
        const publicTools = ((data ?? []) as Array<{ slug: string }>).map((r) => r.slug);
        const merged = mergeToolAccess(access, publicTools);
        setToolAccess(merged.toolAccess);
    }, [supabase]);

    useEffect(() => {
        refreshAccess();
    }, [refreshAccess]);

    useEffect(() => {
        const onFocus = () => refreshAccess();
        const onVisible = () => {
            if (document.visibilityState === "visible") refreshAccess();
        };
        window.addEventListener("focus", onFocus);
        document.addEventListener("visibilitychange", onVisible);
        return () => {
            window.removeEventListener("focus", onFocus);
            document.removeEventListener("visibilitychange", onVisible);
        };
    }, [refreshAccess]);

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (avatarRef.current && !avatarRef.current.contains(e.target as Node)) {
                setAvatarOpen(false);
            }
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, []);

    useEffect(() => {
        if (!avatarOpen) setToolsOpen(false);
    }, [avatarOpen]);

    const handleLogout = async () => {
        setAvatarOpen(false);
        await supabase.auth.signOut();
        router.push("/login");
        router.refresh();
    };

    const isDark = resolvedTheme === "dark";

    // Admins keep the branded avatar; everyone else gets a stable per-user
    // random-looking blob (seeded from their email so it never flickers).
    const avatarKey = admin && user
        ? "alain00"
        : hashSeed(user?.email ?? "anon");

    const menuItemCls =
        "flex items-center gap-2.5 rounded-[0.5em] px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

    // Only surface tools the user has been granted (admins implicitly get all).
    const accessibleTools = TOOLS.filter((t) =>
        canAccessTool({ role: admin ? "admin" : "user", toolAccess }, t.slug)
    );

    return (
        <SiteHeader className="sticky top-0 z-50">
            {/* Avatar — only thing on the right */}
            <div ref={avatarRef} className="relative">
                {user && (
                    <>
                        <button
                            onClick={() => setAvatarOpen((v) => !v)}
                            className="flex h-9 w-9 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-gray-200 dark:border-transparent"
                            aria-label="Account menu"
                        >
                            {user.avatar_url ? (
                                <img
                                    src={user.avatar_url}
                                    alt={user.display_name ?? "Avatar"}
                                    className="h-full w-full rounded-full object-cover"
                                />
                            ) : (
                                <Blobatar name={avatarKey} size={36} background="circle" animate="always" />
                            )}
                        </button>

                        {/* Dropdown */}
                        <div
                            className={`absolute right-0 top-full w-56 pt-2 transition-all duration-200 ${avatarOpen
                                ? "pointer-events-auto translate-y-0 opacity-100"
                                : "pointer-events-none -translate-y-1 opacity-0"
                                }`}
                        >
                            <div className="rounded-[0.8em] border border-border bg-card p-1 shadow-md">

                                {/* User info header */}
                                <div className="mb-1 flex items-center gap-2.5 border-b border-border px-3 py-2.5">
                                    <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full">
                                        {user.avatar_url ? (
                                            <img src={user.avatar_url} alt="" className="h-full w-full rounded-full object-cover" />
                                        ) : (
                                            <Blobatar name={avatarKey} size={32} background="circle" animate="always" />
                                        )}
                                    </div>
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-1.5">
                                            <p className="truncate text-sm font-medium text-foreground">
                                                {user.display_name ?? "Account"}
                                            </p>
                                            {admin && (
                                                <span className="shrink-0 rounded-full border border-fuchsia-400/40 bg-fuchsia-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-fuchsia-400">
                                                    admin
                                                </span>
                                            )}
                                        </div>
                                        <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                                    </div>
                                </div>

                                {/* Tools expandable — hidden entirely when no tool is granted */}
                                {accessibleTools.length > 0 && (
                                    <>
                                        <button
                                            onClick={() => setToolsOpen((v) => !v)}
                                            className={`w-full ${menuItemCls} justify-between`}
                                        >
                                            <span className="flex items-center gap-2.5">
                                                <HiOutlineViewGrid size={15} className="shrink-0" />
                                                Tools
                                            </span>
                                            <HiOutlineChevronRight
                                                size={14}
                                                className={`transition-transform duration-200 ${toolsOpen ? "rotate-90" : ""}`}
                                            />
                                        </button>

                                        <div
                                            className={`overflow-hidden transition-all duration-200 ${toolsOpen ? "max-h-48 opacity-100" : "max-h-0 opacity-0"
                                                }`}
                                        >
                                            <div className="pl-3">
                                                {accessibleTools.map((t) => {
                                                    const Icon = toolIcon(t.slug);
                                                    return (
                                                        <Link
                                                            key={t.slug}
                                                            href={t.path}
                                                            onClick={() => setAvatarOpen(false)}
                                                            className={menuItemCls}
                                                        >
                                                            <Icon size={15} className="shrink-0" />
                                                            {t.title}
                                                        </Link>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    </>
                                )}

                                <div className="my-1 border-t border-border" />

                                {admin && (
                                    <Link
                                        href="/manage-users"
                                        onClick={() => setAvatarOpen(false)}
                                        className={menuItemCls}
                                    >
                                        <HiOutlineShieldCheck size={15} className="shrink-0" />
                                        Manage Users
                                    </Link>
                                )}
                                {/* Temporarily hidden — restore when these pages are built.
                                <Link
                                    href="/dashboard/account"
                                    onClick={() => setAvatarOpen(false)}
                                    className={menuItemCls}
                                >
                                    <HiOutlineUser size={15} className="shrink-0" />
                                    Account
                                </Link>
                                <Link
                                    href="/dashboard/settings"
                                    onClick={() => setAvatarOpen(false)}
                                    className={menuItemCls}
                                >
                                    <HiOutlineCog size={15} className="shrink-0" />
                                    Settings
                                </Link>
                                */}

                                {/* Theme toggle */}
                                <button
                                    onClick={() => setTheme(isDark ? "light" : "dark")}
                                    className={`w-full ${menuItemCls}`}
                                >
                                    <span className="flex items-center gap-2.5">
                                        {isDark
                                            ? <HiOutlineSun size={15} className="shrink-0" />
                                            : <HiOutlineMoon size={15} className="shrink-0" />
                                        }
                                        {isDark ? "Light mode" : "Dark mode"}
                                    </span>
                                </button>

                                <div className="my-1 border-t border-border" />

                                <button
                                    onClick={handleLogout}
                                    className="flex w-full cursor-pointer items-center gap-2.5 rounded-[0.5em] bg-red-500/10 px-3 py-2.5 text-sm text-red-500 transition-colors hover:bg-red-500/20 dark:text-red-400"
                                >
                                    <HiOutlineLogout size={15} className="shrink-0" />
                                    Logout
                                </button>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </SiteHeader>
    );
}
