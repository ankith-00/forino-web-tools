"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { ThemeToggle } from "@/components/theme-toggle";
import { HiOutlineEye, HiOutlineEyeOff, HiOutlineExclamation, HiOutlineCheck } from 'react-icons/hi';

function useBrowserHasNativeReveal(): boolean {
    const [hasNative, setHasNative] = useState(false);
    useEffect(() => {
        const isLegacyEdge = !!(window as unknown as { documentMode?: number }).documentMode;
        setHasNative(isLegacyEdge);
    }, []);
    return hasNative;
}

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

        const supabase = createClient();

        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: {
                    display_name: displayName,
                },
            },
        });

        if (error) {
            setErrorMsg(error.message);
            setLoading(false);
            return;
        }

        if (data.session) {
            router.push("/dashboard");
            router.refresh();
        } else {
            setMessage(
                "Registration successful! Please check your email to confirm your account."
            );
            setLoading(false);
        }
    };

    return (
        <div className="relative flex h-svh w-full flex-col items-center justify-center bg-background px-4 font-sans text-foreground">
            <header className="absolute inset-x-0 top-0 flex items-center justify-end border-b border-border bg-background/80 px-6 py-3 backdrop-blur">
                <ThemeToggle />
            </header>
            <form
                onSubmit={handleRegister}
                className="flex w-full max-w-md flex-col gap-4 rounded-[0.8em] border border-border bg-card p-8 shadow-sm"
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
                        <span className="text-primary underline">Terms &amp; Conditions</span>
                    </label>
                </div>

                <button
                    className="mt-2 cursor-pointer rounded-[0.8em] bg-primary py-3 px-3 text-base text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                    type="submit"
                    disabled={loading || !isPasswordValid || !acceptedTerms}
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
        </div>
    );
}

export default RegisterPage;
