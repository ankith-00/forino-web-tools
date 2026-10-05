"use client";

import { useState } from "react";
import { HiOutlineCheck, HiOutlineExclamation } from "react-icons/hi";
import {
    BRANDING_LIMITS,
    DEFAULT_SITE_TITLE,
    brandingEqual,
    normaliseBranding,
    type UserBranding,
} from "@/lib/site-branding";
import { updateUserBranding } from "./actions";

/**
 * The "Site configuration" row in a user card.
 *
 * Sets the site title and footer note for one account. The user sees these in the
 * header wordmark and the footer, and nobody else does — the values live in their
 * own `app_metadata`.
 *
 * Empty fields mean "clear this and go back to the platform default", which is the
 * whole revert mechanism: there is no separate reset button to get out of sync with
 * the inputs. Nothing on screen says so — the placeholder inside an empty input is
 * the only cue, which is why those placeholders carry the actual defaults rather
 * than generic text like "none".
 *
 * Rendered inside the card's existing accordion, and kept in its own file because
 * it owns real local state and the user card is already a large file.
 */
export default function BrandingSection({
    userId,
    userLabel,
    initial,
    onDone,
}: {
    userId: string;
    /** Shown in the status line so a save is attributable to the right person. */
    userLabel: string;
    initial: UserBranding;
    /** Re-renders the list so the summary badge reflects the saved values. */
    onDone: () => void;
}) {
    const [siteTitle, setSiteTitle] = useState(initial.siteTitle ?? "");
    const [footerNote, setFooterNote] = useState(initial.footerNote ?? "");
    const [status, setStatus] = useState<{ type: "success" | "error"; text: string } | null>(null);
    const [saving, setSaving] = useState(false);

    // Compare against what is stored, not against the inputs, so a value that
    // normalises back to the same thing is correctly treated as unchanged.
    const dirty = !brandingEqual(normaliseBranding({ siteTitle, footerNote }), initial);

    const save = async () => {
        setSaving(true);
        setStatus(null);
        try {
            await updateUserBranding(userId, siteTitle, footerNote);
            setStatus({ type: "success", text: `Saved for ${userLabel}.` });
            onDone();
        } catch (e) {
            setStatus({
                type: "error",
                text: e instanceof Error ? e.message : "Could not save site configuration.",
            });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="border-t border-border p-4">
            <div className="grid gap-3">
                <label className="grid gap-1.5">
                    <span className="text-xs font-medium text-foreground">Site title</span>
                    <input
                        type="text"
                        value={siteTitle}
                        onChange={(e) => setSiteTitle(e.target.value)}
                        maxLength={BRANDING_LIMITS.siteTitle}
                        placeholder={DEFAULT_SITE_TITLE}
                        className="rounded-[0.6em] border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none"
                    />
                </label>

                <label className="grid gap-1.5">
                    <span className="text-xs font-medium text-foreground">Footer note</span>
                    <input
                        type="text"
                        value={footerNote}
                        onChange={(e) => setFooterNote(e.target.value)}
                        maxLength={BRANDING_LIMITS.footerNote}
                        placeholder="MADE WITH LOVE BY : ANKITH"
                        className="rounded-[0.6em] border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none"
                    />
                </label>
            </div>

            {status && (
                <div
                    className={`mt-3 flex items-center gap-2 rounded-[0.6em] border px-2.5 py-2 text-xs ${
                        status.type === "success"
                            ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            : "border-red-400/30 bg-red-500/10 text-red-500 dark:text-red-400"
                    }`}
                >
                    <span className="shrink-0">
                        {status.type === "success" ? <HiOutlineCheck size={13} /> : <HiOutlineExclamation size={13} />}
                    </span>
                    <span>{status.text}</span>
                </div>
            )}

            <div className="mt-3 flex items-center justify-end gap-2">
                <button
                    type="button"
                    onClick={save}
                    disabled={saving || !dirty}
                    className="cursor-pointer rounded-[0.6em] border border-blue-500/30 bg-blue-500/10 px-4 py-1.5 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-500/15 disabled:cursor-not-allowed disabled:opacity-50 dark:text-blue-400"
                >
                    {saving ? "Saving…" : dirty ? "Save configuration" : "No changes"}
                </button>
            </div>
        </div>
    );
}