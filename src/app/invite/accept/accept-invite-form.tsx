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
    email: string;
}

/**
 * The password rules are enforced in the accept action too; this is a hint, not
 * the check. Keep the wording identical to that in ./actions.ts so a user isn't
 * told one thing and held to another.
 */
const RULES = [
    "At least 6 characters",
    "Contains a number",
    "Contains a special character",
];

export default function AcceptInviteForm({ token, displayName, email }: Props) {
    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");
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
            const result = await acceptInvite(token, password);
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
                <p className="mt-1 break-all text-xs text-muted-foreground/80">{email}</p>
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

            <ul className="flex list-inside list-disc flex-col gap-0.5 text-xs text-muted-foreground">
                {RULES.map((r) => (
                    <li key={r}>{r}</li>
                ))}
            </ul>

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

            <button
                className="cursor-pointer rounded-[0.8em] bg-primary py-3 px-3 text-base text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                type="submit"
                disabled={pending}
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
