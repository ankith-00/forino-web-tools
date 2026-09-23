"use client"

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client'
import { ThemeToggle } from "@/components/theme-toggle";
import { HiOutlineEye, HiOutlineEyeOff, HiOutlineExclamation } from 'react-icons/hi';

/** Returns true only on legacy Edge which injects its own reveal button.
 *  All other browsers (Chrome, Firefox, Safari) do NOT show a native toggle
 *  on plain password inputs, so we always render our custom one. */
function useBrowserHasNativeReveal(): boolean {
    const [hasNative, setHasNative] = useState(false);
    useEffect(() => {
        const isLegacyEdge = !!(window as unknown as { documentMode?: number }).documentMode;
        setHasNative(isLegacyEdge);
    }, []);
    return hasNative;
}

function LoginPage() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const browserHasNativeReveal = useBrowserHasNativeReveal();

    const router = useRouter();
    const supabase = createClient();

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setLoading(true);

        const { error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });

        if (error) {
            setError(error.message);
            setLoading(false);
        } else {
            router.push('/dashboard');
            router.refresh();
        }
    };

    return (
        <div className="relative flex h-svh w-full flex-col items-center justify-center bg-background px-4 font-sans text-foreground">
            <header className="absolute inset-x-0 top-0 flex items-center justify-end border-b border-border bg-background/80 px-6 py-3 backdrop-blur">
                <ThemeToggle />
            </header>
            <form
                onSubmit={handleLogin}
                className="flex w-full max-w-md flex-col gap-5 rounded-[0.8em] border border-border bg-card p-8 shadow-sm"
            >
                <h1 className="text-2xl font-bold">LOGIN</h1>

                {error && (
                    <div className="flex items-center gap-3 rounded-[0.8em] border border-red-400/40 bg-red-500/10 px-2.5 py-2.5 text-sm text-red-500 dark:border-red-400/30 dark:bg-red-500/15 dark:text-red-400">
                        <span className="flex shrink-0 items-center justify-center rounded-[0.4em] bg-red-500/20 p-2 dark:bg-red-400/20">
                            <HiOutlineExclamation size={16} />
                        </span>
                        <span>{error}</span>
                    </div>
                )}

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
                        type={showPassword ? 'text' : 'password'}
                        name="password"
                        placeholder="Password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                    />
                    {!browserHasNativeReveal && (
                        <button
                            type="button"
                            aria-label={showPassword ? 'Hide password' : 'Show password'}
                            onClick={() => setShowPassword((v) => !v)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer text-muted-foreground transition-colors hover:text-foreground focus:outline-none"
                            tabIndex={-1}
                        >
                            {showPassword ? <HiOutlineEyeOff size={22} /> : <HiOutlineEye size={22} />}
                        </button>
                    )}
                </div>

                <button
                    className="cursor-pointer rounded-[0.8em] bg-primary py-3 px-3 text-base text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                    type="submit"
                    disabled={loading}
                >
                    {loading ? 'Logging in...' : 'Login'}
                </button>

                <p className="text-center text-muted-foreground">
                    Don&apos;t have an account?{' '}
                    <Link href="/register" className="text-primary underline underline-offset-2">
                        create one
                    </Link>
                </p>
            </form>
        </div>
    );
}

export default LoginPage;
