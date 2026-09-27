"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { HiOutlineExclamation } from "react-icons/hi";

    /** Set by /api/auth/confirm when it bounces an invalid or expired link back to login. */
const MESSAGES: Record<string, string> = {
    failed:
        "That confirmation link is invalid or has expired. Please register again to get a fresh link.",
    invalid: "That confirmation link was incomplete. Please register again.",
};

function ConfirmNoticeInner() {
    const reason = useSearchParams().get("confirm");
    const message = reason ? MESSAGES[reason] : null;

    if (!message) return null;

    return (
        <div className="flex items-center gap-3 rounded-[0.8em] border border-amber-400/40 bg-amber-500/10 px-2.5 py-2.5 text-sm text-amber-600 dark:border-amber-400/30 dark:bg-amber-500/15 dark:text-amber-400">
            <span className="flex shrink-0 items-center justify-center rounded-[0.4em] bg-amber-500/20 p-2 dark:bg-amber-400/20">
                <HiOutlineExclamation size={16} />
            </span>
            <span>{message}</span>
        </div>
    );
}

/**
 * Lives behind its own Suspense boundary because useSearchParams needs one on
 * a prerendered page. Isolating it here keeps the rest of the login form
 * server-rendered instead of opting the whole page into client rendering.
 */
export default function ConfirmNotice() {
    return (
        <Suspense fallback={null}>
            <ConfirmNoticeInner />
        </Suspense>
    );
}
