"use client"

import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/utils/supabase/client'
import { useBrowserHasNativeReveal } from '@/lib/use-browser-has-native-reveal';
import ConfirmNotice from "@/components/auth/ConfirmNotice";
import { HiOutlineEye, HiOutlineEyeOff, HiOutlineExclamation, HiOutlineCheck } from 'react-icons/hi';

/**
 * Set by /invite/accept once the account exists: they chose a password but no
 * session was created, so tell them to use it here.
 *
 * Isolated behind its own Suspense boundary because useSearchParams opts a
 * client component out of static rendering, and only this notice needs the query
 * string — the rest of the form still prerenders.
 */
function InvitedNotice() {
  const invited = useSearchParams().get('invited') === '1';
  if (!invited) return null;
  return (
    <div className="flex items-center gap-3 rounded-[0.8em] border border-green-400/40 bg-green-500/10 px-2.5 py-2.5 text-sm text-green-600 dark:border-green-400/30 dark:bg-green-500/15 dark:text-green-400">
      <span className="flex shrink-0 items-center justify-center rounded-[0.4em] bg-green-500/20 p-2 dark:bg-green-400/20">
        <HiOutlineCheck size={16} />
      </span>
      <span>Your account is ready. Sign in with the password you just chose.</span>
    </div>
  );
}

/**
 * Supabase reports a platform ban with a message that confirms the account
 * exists — the alternative to a wrong-password error is a *different* error, and
 * that difference is enough to enumerate which addresses are registered here.
 *
 * So a banned user is shown exactly what a bad password gets. Nothing is lost:
 * they cannot sign in either way, and telling them "you are banned" tells an
 * attacker more than it tells the person holding the keyboard.
 *
 * "Email not confirmed" leaks the same fact for the same reason, so it is folded
 * into the same response.
 */
function genericLoginError(message: string): string {
  const m = message.toLowerCase();
  const revealsAccountState =
    m.includes('banned') ||
    m.includes('logins are disabled') ||
    m.includes('email not confirmed') ||
    m.includes('signups not allowed');
  return revealsAccountState ? 'Invalid email or password.' : message;
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
            setError(genericLoginError(error.message));
            setLoading(false);
        } else {
            router.push('/dashboard');
            router.refresh();
        }
    };

    return (
        <form
            onSubmit={handleLogin}
            className="flex w-full max-w-md flex-col gap-5 rounded-[0.8em] border border-border bg-card p-5 shadow-sm sm:p-8"
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

            <ConfirmNotice />

            <Suspense fallback={null}>
              <InvitedNotice />
            </Suspense>

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
    );
}

export default LoginPage;
