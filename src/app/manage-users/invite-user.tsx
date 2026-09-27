"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { HiOutlineUserAdd, HiOutlineCheck } from "react-icons/hi";
import { inviteUser } from "./actions";

/**
 * Admin-only invitation form, shown as a dialog from the Manage Users header.
 *
 * The page is a Server Component, so this has to be a client component to hold
 * the open/closed state. It calls the `inviteUser` server action directly rather
 * than POSTing to a route, which is the same pattern the rest of this page uses.
 *
 * There is deliberately no X in the corner: the Cancel button, the Escape key and
 * a backdrop click all close it, and on a phone the corner button sat under the
 * thumb that was already heading for Cancel.
 */
export default function InviteUser() {
    const [open, setOpen] = useState(false);
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();
    const nameRef = useRef<HTMLInputElement>(null);
    const dialogRef = useRef<HTMLDivElement>(null);

    // Open on the name field so the admin can type straight away.
    useEffect(() => {
        if (open) nameRef.current?.focus();
    }, [open]);

    // Escape closes, and the page behind must not scroll while the dialog is up.
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") close();
        };
        document.addEventListener("keydown", onKey);
        const previous = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            document.removeEventListener("keydown", onKey);
            document.body.style.overflow = previous;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    function close() {
        setOpen(false);
        setError(null);
        setSuccess(null);
        setName("");
        setEmail("");
    }

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setSuccess(null);

        startTransition(async () => {
            const result = await inviteUser(name, email);
            if (result.ok) {
                setSuccess(result.message);
                setName("");
                setEmail("");
                return;
            }
            setError(result.message);
        });
    };

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                aria-label="Invite user"
                // `ml-auto` matters once the header wraps at a narrow width: the
                // heading takes the first line and this would otherwise be left
                // alone on the second, which `justify-between` pins to the start.
                // The auto margin keeps it against the right edge on mobile and is
                // a no-op on desktop, where it already sits there.
                className="ml-auto flex shrink-0 cursor-pointer items-center gap-2 rounded-[0.6em] border border-border bg-card px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
                <HiOutlineUserAdd size={15} className="text-muted-foreground" />
                {/* Icon-only on mobile so it doesn't push the heading around on a
                    narrow screen, matching the Filter button in the search row.
                    aria-label above keeps the accessible name identical at every
                    width, so hiding the text costs nothing. */}
                <span className="hidden whitespace-nowrap sm:inline">Invite user</span>
            </button>

            {open && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
                    onClick={close}
                >
                    <div
                        ref={dialogRef}
                        className="w-full max-w-md rounded-[0.8em] border border-border bg-card p-6 shadow-lg"
                        onClick={(e) => e.stopPropagation()}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="invite-user-title"
                    >
                        <h2 id="invite-user-title" className="text-base font-semibold text-foreground">
                            Invite a user
                        </h2>

                        <p className="mt-1 text-xs text-muted-foreground">
                            They&apos;ll get an email to set their password.
                        </p>

                        {success && (
                            <div className="mt-4 flex items-start gap-2.5 rounded-[0.6em] border border-green-400/40 bg-green-500/10 px-3 py-2.5 text-sm text-green-600 dark:border-green-400/30 dark:bg-green-500/15 dark:text-green-400">
                                <HiOutlineCheck size={16} className="mt-0.5 shrink-0" />
                                <span>{success}</span>
                            </div>
                        )}

                        {error && (
                            <div
                                role="alert"
                                className="mt-4 rounded-[0.6em] border border-red-400/40 bg-red-500/10 px-3 py-2.5 text-sm text-red-500 dark:border-red-400/30 dark:bg-red-500/15 dark:text-red-400"
                            >
                                {error}
                            </div>
                        )}

                        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
                            <div className="flex flex-col gap-1.5">
                                <label
                                    htmlFor="invite-name"
                                    className="text-sm font-medium text-foreground"
                                >
                                    Name
                                </label>
                                <input
                                    ref={nameRef}
                                    id="invite-name"
                                    type="text"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder="Ada Lovelace"
                                    maxLength={120}
                                    autoComplete="off"
                                    required
                                    className="rounded-[0.6em] border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-0"
                                />
                            </div>

                            <div className="flex flex-col gap-1.5">
                                <label
                                    htmlFor="invite-email"
                                    className="text-sm font-medium text-foreground"
                                >
                                    Email
                                </label>
                                <input
                                    id="invite-email"
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="ada@example.com"
                                    autoComplete="off"
                                    required
                                    className="rounded-[0.6em] border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-0"
                                />
                            </div>

                            <div className="mt-1 flex justify-end gap-2">
                                <button
                                    type="button"
                                    onClick={close}
                                    className="cursor-pointer rounded-[0.6em] border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
                                >
                                    {success ? "Close" : "Cancel"}
                                </button>
                                <button
                                    type="submit"
                                    disabled={pending || !!success}
                                    className="cursor-pointer rounded-[0.6em] bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    {pending ? "Sending…" : "Send invitation"}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </>
    );
}
