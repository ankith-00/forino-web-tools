import { redirect } from "next/navigation";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import ToolVisibilityToggle from "@/components/ToolVisibilityToggle";
import { createClient } from "@/utils/supabase/server";
import { TOOLS, userAccess, mergeToolAccess, canAccessTool } from "@/lib/access";
import { fetchPublicTools } from "@/lib/public-tools";
import { LuBookOpen, LuScanBarcode, LuFileChartColumn, LuCamera, LuUsers, LuFileText } from "react-icons/lu";
import { HiOutlineUser, HiOutlineDeviceMobile, HiOutlineLockClosed } from "react-icons/hi";
import { IoChevronForwardOutline } from "react-icons/io5";

const TOOL_ICONS: Record<string, { icon: typeof LuScanBarcode }> = {
    scanner: { icon: LuScanBarcode },
    "booklet-scanner": { icon: LuBookOpen },
    "webcam-scanner": { icon: LuCamera },
    barcode: { icon: LuFileChartColumn },
    "id-card": { icon: LuUsers },
    "attendance-records": { icon: LuFileText },
};

/** Titles live on TOOLS in `@/lib/access` so the navbar and dashboard agree; this is the card's extra copy. */
const TOOL_META: Record<string, { description: string; note?: string; noteIcon?: typeof HiOutlineDeviceMobile }> = {
    scanner: {
        description: "Mark attendance by scanning hall ticket, QP code and answer booklet barcodes.",
        note: "Made for mobile screen",
        noteIcon: HiOutlineDeviceMobile,
    },
    "booklet-scanner": {
        description: "Scan a bound document two pages at a time and check the pages are in order.",
        note: "Landscape mode only",
        noteIcon: HiOutlineDeviceMobile,
    },
    "webcam-scanner": {
        description: "Scan answer booklets page by page using your device camera. Automatically uploads to Supabase.",
        note: "Camera required",
        noteIcon: HiOutlineDeviceMobile,
    },
    barcode: {
        description: "Upload a hall ticket PDF and stamp barcodes onto each student's ticket.",
    },
    "id-card": {
        description: "Generate student ID cards from your records.",
    },
    "attendance-records": {
        description: "View attendance logs and scanned answer booklets.",
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
                        const { icon: Icon } = TOOL_ICONS[t.slug] ?? {};
                        const NoteIcon = meta?.noteIcon;
                        if (!meta || !Icon) return null;
                        return (
                            <div key={t.slug} className="relative">
                                <Link
                                    href={t.path}
                                    className="group flex h-full cursor-pointer flex-col gap-4 rounded-[0.8em] border border-border bg-card p-5 pr-12 shadow-sm transition-all hover:border-primary/40 hover:bg-muted/40"
                                >
                                    <div className="flex h-11 w-11 items-center justify-center rounded-[0.8em] bg-primary/10 text-primary">
                                        <Icon size={22} />
                                    </div>
                                    <div className="flex-1">
                                        <p className="text-sm font-semibold text-foreground">{t.title}</p>
                                        <p className="mt-1 text-xs text-muted-foreground">{meta.description}</p>
                                        {meta.note && NoteIcon && (
                                            <p className="mt-3 inline-flex items-center gap-1.5 rounded-[0.5em] bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                                                <NoteIcon size={13} />
                                                {meta.note}
                                            </p>
                                        )}
                                    </div>
                                    <span className="flex items-center gap-1 text-xs font-medium text-primary">
                                        Open tool
                                        <IoChevronForwardOutline
                                            size={13}
                                            className="transition-transform group-hover:translate-x-0.5"
                                        />
                                    </span>
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
            <footer className="py-4 text-center text-xs text-muted-foreground">
                MADE WITH 💖 BY : <Link href="https://www.ankith.dev" target="_blank" className=" text-blue-500 underline font-semibold">ANKITH</Link>
            </footer>
        </div>
    );
}