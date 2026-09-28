"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { HiOutlineExclamation } from "react-icons/hi";
import { acceptInvite } from "./actions";

interface Props {
    /** Raw one-time token from the link. Never rendered. */
    token: string;
    displayName: string | null;
}

/**
 * The password rules are enforced in the accept action too, and come back as the
 * error banner if they are not met. The rules are deliberately not listed here:
 * this card is a one-field-tap for somebody who has just been invited, and the
 * list said more about the form than the invitation did.
 */
export default function AcceptInviteForm({ token, displayName }: Props) {
    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");
    const [acceptedTerms, setAcceptedTerms] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();
    const router = useRouter();

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        if (password !== confirm) {
            setError("Those passwords don't match.");
            return;
        }

        startTransition(async () => {
            const result = await acceptInvite(token, password, acceptedTerms);
            if (result.ok) {
                // No session is created here — createUser runs with the service
                // role and does not sign anybody in — so send them to log in with
                // the password they just chose.
                router.push("/login?invited=1");
                router.refresh();
                return;
            }
            setError(result.error ?? "Something went wrong. Please try again.");
        });
    };

    return (
        <form
            onSubmit={handleSubmit}
            className="flex w-full max-w-md flex-col gap-5 rounded-[0.8em] border border-border bg-card p-5 shadow-sm sm:p-8"
        >
            <div className="text-center">
                <h1 className="text-xl font-bold">Set your password</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    {displayName ? `Welcome, ${displayName}.` : "Welcome."} Choose a password to
                    finish joining Forino.
                </p>
            </div>

            {error && (
                <div className="flex items-center gap-3 rounded-[0.8em] border border-red-400/40 bg-red-500/10 px-2.5 py-2.5 text-sm text-red-500 dark:border-red-400/30 dark:bg-red-500/15 dark:text-red-400">
                    <span className="flex shrink-0 items-center justify-center rounded-[0.4em] bg-red-500/20 p-2 dark:bg-red-400/20">
                        <HiOutlineExclamation size={16} />
                    </span>
                    <span>{error}</span>
                </div>
            )}

            <div className="flex flex-col gap-1.5">
                <label htmlFor="invite-password" className="text-sm font-medium">
                    Password
                </label>
                <input
                    id="invite-password"
                    className="rounded-[0.8em] border border-border bg-background p-2.5 px-4 focus:outline-0"
                    type="password"
                    name="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                />
            </div>

            <div className="flex flex-col gap-1.5">
                <label htmlFor="invite-confirm" className="text-sm font-medium">
                    Confirm password
                </label>
                <input
                    id="invite-confirm"
                    className="rounded-[0.8em] border border-border bg-background p-2.5 px-4 focus:outline-0"
                    type="password"
                    name="confirmPassword"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                />
            </div>

            {/* Same wording and control as the registration form, so accepting the
                terms reads the same wherever an account is created. Enforced again
                in the action: this form is a courtesy, not the gate. */}
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <input
                    type="checkbox"
                    id="invite-terms"
                    className="h-4 w-4 cursor-pointer accent-primary"
                    checked={acceptedTerms}
                    onChange={(e) => setAcceptedTerms(e.target.checked)}
                    required
                />
                <label htmlFor="invite-terms" className="cursor-pointer">
                    I agree to the{" "}
                    <Link
                        href="/terms"
                        target="_blank"
                        className="text-primary underline underline-offset-2"
                    >
                        Terms &amp; Conditions
                    </Link>
                </label>
            </div>

            <button
                className="cursor-pointer rounded-[0.8em] bg-primary py-3 px-3 text-base text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                type="submit"
                disabled={pending || !acceptedTerms}
            >
                {pending ? "Creating your account…" : "Join Forino"}
            </button>

            <p className="text-center text-sm text-muted-foreground">
                Already have an account?{" "}
                <Link href="/login" className="text-primary underline underline-offset-2">
                    sign in
                </Link>
            </p>
        </form>
    );
}
