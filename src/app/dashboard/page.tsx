import Link from "next/link";
import Navbar from "@/components/Navbar";
import { LuScanBarcode, LuFileChartColumn } from "react-icons/lu";
import { HiOutlineUser, HiOutlineDeviceMobile } from "react-icons/hi";
import { IoChevronForwardOutline } from "react-icons/io5";

const TOOLS = [
    {
        href: "/scanner",
        title: "Barcode Scanner",
        description: "Mark attendance by scanning hall ticket, QP code and answer booklet barcodes.",
        note: "Made for mobile screen",
        noteIcon: HiOutlineDeviceMobile,
        icon: LuScanBarcode,
    },
    {
        href: "/barcode",
        title: "Barcode Marker",
        description: "Upload a hall ticket PDF and stamp barcodes onto each student's ticket.",
        icon: LuFileChartColumn,
    },
    {
        href: "/id-card",
        title: "ID Card Maker",
        description: "Generate student ID cards from your records.",
        icon: HiOutlineUser,
    },
];

export default function DashboardPage() {
    return (
        <div className="flex min-h-svh flex-col bg-background font-sans text-foreground">
            <Navbar />
            <main className="mx-auto w-full max-w-6xl flex-1 px-6 pb-6 pt-8">
                <h1 className="text-2xl font-semibold">Tools</h1>
                <p className="mt-1 max-w-lg text-sm text-muted-foreground">
                    Quick access to everything in Forino.
                </p>

                <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {TOOLS.map(({ href, title, description, note, noteIcon: NoteIcon, icon: Icon }) => (
                        <Link
                            key={href}
                            href={href}
                            className="group flex cursor-pointer flex-col gap-4 rounded-[0.8em] border border-border bg-card p-5 shadow-sm transition-all hover:border-primary/40 hover:bg-muted/40"
                        >
                            <div className="flex h-11 w-11 items-center justify-center rounded-[0.8em] bg-primary/10 text-primary">
                                <Icon size={22} />
                            </div>
                            <div className="flex-1">
                                <p className="text-sm font-semibold text-foreground">{title}</p>
                                <p className="mt-1 text-xs text-muted-foreground">{description}</p>
                                {note && NoteIcon && (
                                    <p className="mt-3 inline-flex items-center gap-1.5 rounded-[0.5em] bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                                        <NoteIcon size={13} />
                                        {note}
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
                    ))}
                </div>
            </main>
            <footer className="py-4 text-center text-xs text-muted-foreground">
                MADE WITH 💖 BY : <Link href="https://www.ankith.dev" target="_blank" className=" text-blue-500 underline font-semibold">ANKITH</Link>
            </footer>
        </div>
    );
}