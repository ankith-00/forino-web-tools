"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toggleToolPublic } from "@/app/manage-users/actions";
import { HiOutlineGlobeAlt, HiOutlineLockClosed } from "react-icons/hi";

export default function ToolVisibilityToggle({
    slug,
    label,
    isPublic,
    isAdmin,
}: {
    slug: string;
    label: string;
    isPublic: boolean;
    isAdmin: boolean;
}) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [open, setOpen] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const confirm = () => {
        setError(null);
        startTransition(async () => {
            try {
                await toggleToolPublic(slug, !isPublic);
                setOpen(false);
                router.refresh();
            } catch (e) {
                setError(e instanceof Error ? e.message : "Something went wrong.");
            }
        });
    };

    const exposureWarning =
        slug === "scanner"
            ? "Every account holder gets student lookup and attendance marking — including full student records."
            : "Every account holder gets immediate use of this tool, without approval.";

    // Non-admins just see a read-only "public" badge (nothing when private).
    if (!isAdmin) {
        if (!isPublic) return null;
        return (
            <span
                title="Public — available to everyone"
                className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-sky-500/40 bg-sky-500/15 text-sky-600 dark:text-sky-400"
            >
                <HiOutlineGlobeAlt size={17} />
            </span>
        );
    }

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                disabled={isPending}
                title={
                    isPublic
                        ? "Public — everyone can use this tool. Click to make it private."
                        : "Private — only granted users can use it. Click to make it public."
                }
                className={`absolute right-3 top-3 z-10 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border transition-colors disabled:opacity-50 ${
                    isPublic
                        ? "border-sky-500/40 bg-sky-500/15 text-sky-600 hover:bg-sky-500/25 dark:text-sky-400"
                        : "border-red-500/40 bg-red-500/15 text-red-500 hover:bg-red-500/25 dark:text-red-400"
                }`}
            >
                {isPublic ? <HiOutlineGlobeAlt size={17} /> : <HiOutlineLockClosed size={17} />}
            </button>

            {open && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
                    onClick={() => setOpen(false)}
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
                                    isPublic
                                        ? "bg-red-500/15 text-red-500 dark:text-red-400"
                                        : "bg-sky-500/15 text-sky-600 dark:text-sky-400"
                                }`}
                            >
                                {isPublic ? (
                                    <HiOutlineLockClosed size={18} />
                                ) : (
                                    <HiOutlineGlobeAlt size={18} />
                                )}
                            </span>
                            <h2 className="text-base font-semibold text-foreground">
                                {isPublic ? "Make private" : "Make public"}
                            </h2>
                        </div>

                        <p className="mt-3 text-sm text-foreground">
                            {isPublic ? (
                                <>
                                    You are about to make <strong>{label}</strong>{" "}
                                    <strong>private</strong>. Users who weren&apos;t granted it individually
                                    will lose access to it.
                                </>
                            ) : (
                                <>
                                    You are about to make <strong>{label}</strong>{" "}
                                    <strong>public</strong>. Every user on the team can use it without an
                                    individual grant, bypassing manual access permissions.{" "}
                                    <span className="text-amber-600 dark:text-amber-400">
                                        {exposureWarning}
                                    </span>
                                </>
                            )}
                        </p>

                        {error && <p className="mt-3 text-xs text-red-500 dark:text-red-400">{error}</p>}

                        <div className="mt-5 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setOpen(false)}
                                disabled={isPending}
                                className="cursor-pointer rounded-[0.6em] border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={confirm}
                                disabled={isPending}
                                className={`cursor-pointer rounded-[0.6em] px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50 ${
                                    isPublic
                                        ? "bg-red-500 hover:bg-red-600"
                                        : "bg-sky-600 hover:bg-sky-700"
                                }`}
                            >
                                {isPending ? "Saving…" : isPublic ? "Make private" : "Make public"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}