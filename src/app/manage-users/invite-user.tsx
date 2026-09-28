"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { HiOutlineUserAdd, HiOutlineCheck, HiChevronDown } from "react-icons/hi";
import { TOOLS } from "@/lib/access";
import { inviteUser } from "./actions";

/** Titles come from the single source of truth in `@/lib/access`. */
const TOOL_LABELS: Record<string, string> = Object.fromEntries(
    TOOLS.map((t) => [t.slug, t.title])
);

/**
 * How long the success banner holds before the form clears itself, so an admin
 * inviting several people in a row gets a blank form with the cursor already in
 * the name field instead of retyping over the last one.
 */
const RESET_DELAY_MS = 3000;

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
export default function InviteUser({ publicTools }: { publicTools: string[] }) {
    const [open, setOpen] = useState(false);
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();
    const nameRef = useRef<HTMLInputElement>(null);
    const dialogRef = useRef<HTMLDivElement>(null);
    const router = useRouter();
    // Held in a ref rather than state: it changes nothing to render, and a timer
    // that fired after the dialog was gone would reset a form nobody can see.
    const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Tool access chosen for the invitee, stored on the invite and applied when
    // they accept. Two lists because the platform has a default for public tools:
    // `mergeToolAccess` hands the public set to everyone, so the only way to deny
    // one is a block. Public tools therefore start checked (nothing to grant) and
    // a private tool is granted by ticking it.
    const [grantedTools, setGrantedTools] = useState<string[]>([]);
    const [blockedTools, setBlockedTools] = useState<string[]>([]);
    const [openSections, setOpenSections] = useState({ public: true, private: false });

    const publicList = TOOLS.filter((t) => publicTools.includes(t.slug));
    const privateList = TOOLS.filter((t) => !publicTools.includes(t.slug));
    const publicEnabled = publicList.length - blockedTools.length;
    const toolTotal = publicEnabled + grantedTools.length;

    /**
     * The form is inert while a send is in flight and for the length of the
     * success banner, so the automatic reset can never wipe something the admin
     * started typing for the next person.
     */
    const locked = pending || !!success;

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

    /** Put the form back to how it opens. Used by close() and the post-send reset. */
    function resetForm() {
        setError(null);
        setSuccess(null);
        setName("");
        setEmail("");
        // Back to the defaults, so the next invitation is never a copy-paste of the
        // last one's access.
        setGrantedTools([]);
        setBlockedTools([]);
    }

    const cancelReset = () => {
        if (resetTimer.current !== null) {
            clearTimeout(resetTimer.current);
            resetTimer.current = null;
        }
    };

    // A pending reset must not outlive the component, or it fires into a form the
    // admin has already closed or navigated away from.
    useEffect(() => cancelReset, []);

    function close() {
        cancelReset();
        setOpen(false);
        resetForm();
    }

    const toggle = (slug: string, current: string[], set: (next: string[]) => void) => {
        set(
            current.includes(slug) ? current.filter((s) => s !== slug) : [...current, slug]
        );
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        // Supersede any reset still in flight from the previous send.
        cancelReset();
        setError(null);
        setSuccess(null);

        startTransition(async () => {
            const result = await inviteUser(name, email, grantedTools, blockedTools);
            if (result.ok) {
                setSuccess(result.message);
                // The Invites tab behind this dialog is server-rendered, so it will
                // not show the invitation that was just sent without a refresh.
                router.refresh();
                // Hold the banner long enough to be read, then clear the form for
                // the next person. The fields are inert until it fires, so the
                // reset can never eat something typed in the meantime.
                resetTimer.current = setTimeout(() => {
                    resetTimer.current = null;
                    resetForm();
                    nameRef.current?.focus();
                }, RESET_DELAY_MS);
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
                        // The tool accordions make this taller than a two-field form, so
                        // cap it to the viewport and let the body scroll rather than
                        // pushing the send button off a short screen.
                        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-[0.8em] border border-border bg-card p-6 shadow-lg"
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
                                    disabled={locked}
                                    className="rounded-[0.6em] border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-0 disabled:cursor-not-allowed disabled:opacity-60"
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
                                    disabled={locked}
                                    className="rounded-[0.6em] border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-0 disabled:cursor-not-allowed disabled:opacity-60"
                                />
                            </div>

                            {/* Tool access, chosen before the invite goes out. Both
                                lists are stored on the invite and applied to the
                                account when the invitee accepts, so this is the only
                                chance to set it without opening their card afterwards. */}
                            <div className="mt-1 flex flex-col gap-2">
                                <div className="flex items-baseline justify-between gap-2">
                                    <span className="text-sm font-medium text-foreground">
                                        Tool access
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                        {toolTotal} of {TOOLS.length} tools
                                    </span>
                                </div>

                                <Accordion
                                    title="Public Tools"
                                    summary={`${publicEnabled} / ${publicList.length} enabled`}
                                    open={openSections.public}
                                    disabled={locked}
                                    onToggle={() =>
                                        setOpenSections((s) => ({ ...s, public: !s.public }))
                                    }
                                >
                                    <p className="mb-3 text-xs text-muted-foreground">
                                        Everyone gets these by default. Untick one to keep it away
                                        from this person.
                                    </p>
                                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                        {publicList.map((t) => (
                                            <ToolCheck
                                                key={t.slug}
                                                label={TOOL_LABELS[t.slug] ?? t.slug}
                                                checked={!blockedTools.includes(t.slug)}
                                                disabled={locked}
                                                onChange={() =>
                                                    toggle(t.slug, blockedTools, setBlockedTools)
                                                }
                                            />
                                        ))}
                                    </div>
                                </Accordion>

                                <Accordion
                                    title="Private Tools"
                                    summary={`${grantedTools.length} / ${privateList.length} granted`}
                                    open={openSections.private}
                                    disabled={locked}
                                    onToggle={() =>
                                        setOpenSections((s) => ({ ...s, private: !s.private }))
                                    }
                                >
                                    <p className="mb-3 text-xs text-muted-foreground">
                                        Not shared with anyone else. Tick to grant it to this person.
                                    </p>
                                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                        {privateList.map((t) => (
                                            <ToolCheck
                                                key={t.slug}
                                                label={TOOL_LABELS[t.slug] ?? t.slug}
                                                checked={grantedTools.includes(t.slug)}
                                                disabled={locked}
                                                onChange={() =>
                                                    toggle(t.slug, grantedTools, setGrantedTools)
                                                }
                                            />
                                        ))}
                                    </div>
                                </Accordion>
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

/** Collapsible section, styled like the accordions on the user cards. */
function Accordion({
    title,
    summary,
    open,
    disabled = false,
    onToggle,
    children,
}: {
    title: string;
    summary: string;
    open: boolean;
    disabled?: boolean;
    onToggle: () => void;
    children: React.ReactNode;
}) {
    return (
        <div className="overflow-hidden rounded-[0.6em] border border-border bg-background">
            <button
                type="button"
                onClick={onToggle}
                aria-expanded={open}
                disabled={disabled}
                className="flex w-full cursor-pointer items-center justify-between gap-2 p-3 text-left transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60"
            >
                <span className="text-sm font-semibold text-foreground">{title}</span>
                <span className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{summary}</span>
                    <HiChevronDown
                        size={16}
                        className={`text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
                    />
                </span>
            </button>
            {open && <div className="border-t border-border p-3">{children}</div>}
        </div>
    );
}

/**
 * A real checkbox wearing the app's chip styling, so the control is a checkbox to
 * the keyboard and to assistive tech while still reading as one of the tool
 * toggles elsewhere on the page.
 */
function ToolCheck({
    label,
    checked,
    disabled = false,
    onChange,
}: {
    label: string;
    checked: boolean;
    disabled?: boolean;
    onChange: () => void;
}) {
    return (
        <label
            className={`relative flex items-center gap-2 rounded-[0.6em] border px-3 py-2 text-xs font-medium transition-colors ${
                disabled
                    ? "cursor-not-allowed opacity-60"
                    : "cursor-pointer"
            } ${
                checked
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : "border-border bg-card text-muted-foreground hover:bg-muted"
            }`}
        >
            <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={onChange}
                className="pointer-events-none absolute h-4 w-4 opacity-0"
            />
            <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[0.35em] border transition-colors ${
                    checked
                        ? "border-emerald-600 bg-emerald-600 text-white"
                        : "border-border bg-background"
                }`}
            >
                {checked && <HiOutlineCheck size={11} />}
            </span>
            <span className="truncate">{label}</span>
        </label>
    );
}
