"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useBrowserHasNativeReveal } from "@/lib/use-browser-has-native-reveal";
import { HiOutlineEye, HiOutlineEyeOff, HiOutlineExclamation, HiOutlineCheck } from 'react-icons/hi';

function RegisterPage() {
    const [displayName, setDisplayName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [acceptedTerms, setAcceptedTerms] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const browserHasNativeReveal = useBrowserHasNativeReveal();
    const router = useRouter();
    const redirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Drop the pending redirect if the component goes away first.
    useEffect(() => {
        return () => {
            if (redirectTimer.current) clearTimeout(redirectTimer.current);
        };
    }, []);

    // Password validation checks
    const hasMinLength = password.length >= 6;
    const hasNumber = /\d/.test(password);
    const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);
    const isPasswordValid = hasMinLength && hasNumber && hasSpecialChar;

    const handleRegister = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setErrorMsg(null);
        setMessage(null);

        if (!isPasswordValid) {
            setErrorMsg("Password must contain at least 6 characters, one number, and one special character.");
            return;
        }

        if (!acceptedTerms) {
            setErrorMsg("You must accept the terms and conditions to proceed.");
            return;
        }

        setLoading(true);

        // Registration goes through our own route so the confirmation email is
        // the branded Resend one. supabase.auth.signUp would send GoTrue's
        // template instead and we would never see the user.
        try {
            const res = await fetch("/api/auth/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, password, displayName }),
            });
            const data = await res.json().catch(() => ({}));

            if (!res.ok) {
                setErrorMsg(data.error ?? "Something went wrong. Please try again.");
                setLoading(false);
                return;
            }

            setMessage("Check your email to confirm your account.");
            setLoading(false);
            // Nudge them to the login page rather than leaving them staring at a
            // form they can no longer use. Three seconds is long enough to read
            // the confirmation and act on it, short enough not to feel stuck.
            // Cleaned up on unmount so a manual navigation first can't leave a
            // timer pointing at a page they've already left.
            redirectTimer.current = setTimeout(() => {
                router.push("/login");
            }, 3000);
        } catch {
            setErrorMsg("Could not reach the server. Please check your connection and try again.");
            setLoading(false);
        }
    };

    return (
        <form
            onSubmit={handleRegister}
            className="flex w-full max-w-md flex-col gap-4 rounded-[0.8em] border border-border bg-card p-5 shadow-sm sm:p-8"
        >
            <h1 className="text-2xl font-bold">CREATE ACCOUNT</h1>

            {errorMsg && (
                <div className="flex items-center gap-3 rounded-[0.8em] border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-500 dark:border-red-400/30 dark:bg-red-500/15 dark:text-red-400">
                    <span className="flex shrink-0 items-center justify-center rounded-[0.4em] bg-red-500/20 p-2 dark:bg-red-400/20">
                        <HiOutlineExclamation size={16} />
                    </span>
                    <span>{errorMsg}</span>
                </div>
            )}

            {message && (
                <div className="flex items-center gap-3 rounded-[0.8em] border border-green-400/40 bg-green-500/10 px-4 py-3 text-sm text-green-600 dark:border-green-400/30 dark:bg-green-500/15 dark:text-green-400">
                    <span className="flex shrink-0 items-center justify-center rounded-[0.4em] bg-green-500/20 p-2 dark:bg-green-400/20">
                        <HiOutlineCheck size={16} />
                    </span>
                    <span>{message}</span>
                </div>
            )}

            <input
                className="rounded-[0.8em] border border-border bg-background p-2.5 px-4 placeholder:text-muted-foreground focus:outline-0"
                type="text"
                name="displayName"
                placeholder="Name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
            />

            <input
                className="rounded-[0.8em] border border-border bg-background p-2.5 px-4 placeholder:text-muted-foreground focus:outline-0"
                type="email"
                name="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
            />

            <div className="relative">
                <input
                    className="w-full rounded-[0.8em] border border-border bg-background p-2.5 px-4 pr-11 placeholder:text-muted-foreground focus:outline-0"
                    type={showPassword ? "text" : "password"}
                    name="password"
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                />
                {!browserHasNativeReveal && (
                    <button
                        type="button"
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        onClick={() => setShowPassword((v) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer text-muted-foreground transition-colors hover:text-foreground focus:outline-none"
                        tabIndex={-1}
                    >
                        {showPassword ? <HiOutlineEyeOff size={22} /> : <HiOutlineEye size={22} />}
                    </button>
                )}
            </div>

            {/* Terms and Conditions Checkbox */}
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <input
                    type="checkbox"
                    id="terms"
                    className="h-4 w-4 cursor-pointer accent-primary"
                    checked={acceptedTerms}
                    onChange={(e) => setAcceptedTerms(e.target.checked)}
                    required
                />
                <label htmlFor="terms" className="cursor-pointer">
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
                className="mt-2 cursor-pointer rounded-[0.8em] bg-primary py-3 px-3 text-base text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                type="submit"
                // `message` locks the form once registration succeeded, so nobody
                // can resubmit during the three seconds before the redirect.
                disabled={loading || !!message || !isPasswordValid || !acceptedTerms}
            >
                {loading ? "Creating Account..." : "Register"}
            </button>

            <p className="text-center text-muted-foreground">
                Already have an account?{" "}
                <Link href="/login" className="text-primary underline">
                    Login
                </Link>
            </p>
        </form>
    );
}

export default RegisterPage;
