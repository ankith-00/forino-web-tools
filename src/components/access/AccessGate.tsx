"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { canAccessTool, mergeToolAccess, userAccess } from "@/lib/access";
import { fetchPublicTools } from "@/lib/public-tools";
import { HiOutlineLockClosed } from "react-icons/hi";

type GateState = "loading" | "denied" | "ok";

/**
 * Blocks rendering of a client component tool unless the signed-in user
 * is an admin or has the tool slug granted in their app_metadata.
 */
export default function AccessGate({ slug, children }: { slug: string; children: ReactNode }) {
    const router = useRouter();
    const supabase = createClient();
    const [state, setState] = useState<GateState>("loading");

    useEffect(() => {
        let active = true;
        (async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                router.replace("/login");
                return;
            }
            const access = userAccess(user);
            if (!active) return;
            const publicTools = await fetchPublicTools(supabase);
            if (!active) return;
            setState(canAccessTool(mergeToolAccess(access, publicTools), slug) ? "ok" : "denied");
        })();
        return () => {
            active = false;
        };
    }, [slug, supabase, router]);

    if (state === "loading") {
        return (
            <div className="flex min-h-svh flex-col items-center justify-center gap-3 bg-background text-sm text-muted-foreground">
                <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                </span>
                Checking access…
            </div>
        );
    }

    if (state === "denied") {
        return (
            <div className="flex min-h-svh items-center justify-center bg-background px-6 font-sans text-foreground">
                <div className="w-full max-w-sm rounded-[1em] border border-border bg-card p-6 text-center shadow-sm">
                    <div className="mb-3 flex justify-center text-muted-foreground">
                        <HiOutlineLockClosed size={32} />
                    </div>
                    <h1 className="text-xl font-semibold">Access required</h1>
                    <p className="mt-2 text-sm text-muted-foreground">
                        You haven&apos;t been granted access to this tool yet. Ask an admin to enable it for your
                        account.
                    </p>
                    <Link
                        href="/dashboard"
                        className="mt-4 inline-flex items-center justify-center rounded-[0.8em] bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                    >
                        Back to Tools
                    </Link>
                </div>
            </div>
        );
    }

    return <>{children}</>;
}