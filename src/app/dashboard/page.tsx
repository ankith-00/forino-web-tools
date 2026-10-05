import { redirect } from "next/navigation";
import Link from "next/link";
import Navbar from "@/components/layout/Navbar";
import { SiteFooter } from "@/components/layout/SiteFooter";
import ToolVisibilityToggle from "@/components/access/ToolVisibilityToggle";
import { createClient } from "@/utils/supabase/server";
import { TOOLS, userAccess, mergeToolAccess, canAccessTool } from "@/lib/access";
import { toolIcon } from "@/lib/tool-icons";
import { fetchPublicTools } from "@/lib/public-tools";
import { HiOutlineLockClosed } from "react-icons/hi";
import { HiOutlineExclamationTriangle } from "react-icons/hi2";
import type { IconType } from "react-icons";

/** Titles live on TOOLS in `@/lib/access` so the navbar and dashboard agree; this is the card's extra copy. */
const TOOL_META: Record<string, { description: string; note?: string; noteIcon?: IconType }> = {
    barcode: {
        description: "Upload a hall ticket PDF and stamp barcodes onto each student's ticket.",
    },
    scanner: {
        description: "Mark attendance by scanning hall ticket, QP code and answer booklet barcodes.",
        note: "Made for mobile screen",
        noteIcon: HiOutlineExclamationTriangle,
    },
    "webcam-scanner": {
        description: "Scan answer booklets page by page using your device camera.",
        note: "Camera required",
        noteIcon: HiOutlineExclamationTriangle,
    },
    "attendance-records": {
        description: "Review and search attendance marked through the barcode scanner.",
    },
    "id-card": {
        description: "Generate student ID cards from your students' records.",
    },
    "magic-frame": {
        description: "Frame photos automatically with a one-tap border.",
        note: "Coming soon",
        noteIcon: HiOutlineExclamationTriangle,
    },
};

export default async function DashboardPage() {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect("/login");

    const publicTools = await fetchPublicTools(supabase);
    const access = mergeToolAccess(userAccess(user), publicTools);
    const isAdmin = access.role === "admin";

    const visibleTools = TOOLS.filter((t) => canAccessTool(access, t.slug));

    return (
        <div className="flex min-h-svh flex-col bg-background font-sans text-foreground">
            <Navbar />
            <main className="mx-auto w-full max-w-6xl flex-1 px-6 pb-6 pt-8">
                {visibleTools.length === 0 ? (
                    <div className="flex flex-col items-center justify-center rounded-[0.8em] border border-border bg-card px-6 py-14 text-center shadow-sm">
                        <div className="flex h-12 w-12 items-center justify-center rounded-[0.8em] bg-muted text-muted-foreground">
                            <HiOutlineLockClosed size={24} />
                        </div>
                        <h1 className="mt-4 text-xl font-semibold">No Tool Access permitted</h1>
                        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                            You don&apos;t have access to any tools yet. Contact an admin to get access.
                        </p>
                    </div>
                ) : (
                    <>
                        <h1 className="text-2xl font-semibold">Tools</h1>
                        <p className="mt-1 max-w-lg text-sm text-muted-foreground">
                            Quick access to everything in Forino.
                        </p>

                        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                            {visibleTools.map((t) => {
                                const meta = TOOL_META[t.slug];
                                const Icon = toolIcon(t.slug);
                                const NoteIcon = meta?.noteIcon;
                                if (!meta) return null;
                                return (
                                    // `sm:h-52` sits on the wrapper rather than the link, so
                                    // the card and the box the visibility toggle is
                                    // positioned against are the same height. Sized to
                                    // clear a three-line description plus the note band,
                                    // so the tallest card no longer stretches its row.
                                    // Left auto on a phone, where the grid is a single
                                    // column and a fixed height would only clip.
                                    <div key={t.slug} className="relative sm:h-52">
                                        <Link
                                            href={t.path}
                                            className="flex h-full cursor-pointer flex-col overflow-hidden rounded-[0.8em] border border-border bg-card shadow-sm transition-all hover:border-primary/40 hover:bg-muted/40"
                                        >
                                            <div className="flex flex-1 flex-col gap-4 p-5 pr-12">
                                                <div className="flex h-11 w-11 items-center justify-center rounded-[0.8em] bg-primary/10 text-primary">
                                                    <Icon size={22} />
                                                </div>
                                                <div>
                                                    <p className="text-sm font-semibold text-foreground">
                                                        {t.title}
                                                    </p>
                                                    <p className="mt-1 text-xs text-muted-foreground">
                                                        {meta.description}
                                                    </p>
                                                </div>
                                            </div>
                                            {/* Requirement badge, full width along the
                                                bottom edge. `flex-1` on the block above
                                                pins it there however long the description
                                                runs, so the badges line up across a row. */}
                                            {meta.note && NoteIcon && (
                                                <p className="flex items-center gap-1.5 border-t border-amber-500/20 bg-amber-500/10 px-5 py-2 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                                                    <NoteIcon size={13} className="shrink-0" />
                                                    {meta.note}
                                                </p>
                                            )}
                                        </Link>
                                        <ToolVisibilityToggle
                                            slug={t.slug}
                                            label={t.title}
                                            isPublic={publicTools.includes(t.slug)}
                                            isAdmin={isAdmin}
                                        />
                                    </div>
                                );
                            })}
                        </div>
                    </>
                )}
            </main>
            <SiteFooter />
        </div>
    );
}