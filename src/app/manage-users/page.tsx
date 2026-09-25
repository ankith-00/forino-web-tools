import { redirect } from "next/navigation";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import { createClient } from "@/utils/supabase/server";
import { isAdmin } from "@/lib/access";
import { listUsers } from "@/lib/admin";
import UsersTable from "./users-table";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect("/login");
    if (!isAdmin(user)) redirect("/dashboard");

    let users: Awaited<ReturnType<typeof listUsers>> = [];
    let loadError: string | null = null;
    try {
        users = await listUsers();
    } catch (e) {
        loadError = e instanceof Error ? e.message : "Failed to load users.";
    }
    const adminCount = users.filter((u) => u.role === "admin").length;
    const nonAdmins = users.filter((u) => u.role !== "admin");

    return (
        <div className="flex min-h-svh flex-col bg-background font-sans text-foreground">
            <Navbar />
            <main className="mx-auto w-full max-w-6xl flex-1 px-6 pb-6 pt-8">
                <div>
                    <h1 className="text-2xl font-semibold">Manage Users</h1>
                    <p className="text-sm text-muted-foreground">
                        Grant or revoke tool access for each user.{adminCount > 0 && ` ${adminCount} admin${adminCount > 1 ? "s" : ""} on this team.`}
                    </p>
                </div>

                {loadError ? (
                    <div className="mt-6 flex flex-col gap-2 rounded-[0.8em] border border-red-400/40 bg-red-500/10 px-4 py-4 text-sm text-red-500 dark:border-red-400/30 dark:bg-red-500/15 dark:text-red-400">
                        <p className="font-medium">Could not load this page.</p>
                        <p>{loadError}</p>
                        <p className="text-xs text-red-400/80 dark:text-red-300/80">
                            If this mentions <code className="font-mono">tool_settings</code>, run the pending
                            Supabase migration <code className="font-mono">20260925000001_tool_settings.sql</code>{" "}
                            (e.g. <code className="font-mono">supabase db push</code> or the dashboard SQL
                            editor), then reload.
                        </p>
                    </div>
                ) : (
                    <UsersTable users={nonAdmins} />
                )}

                <p className="mt-6 text-xs text-muted-foreground">
                    Changes apply immediately on the target user&apos;s next page load. Requests are verified
                    server-side, so the UI is only a convenience — the real permission check happens on every page
                    and API call.
                </p>
            </main>
            <footer className="py-4 text-center text-xs text-muted-foreground">
                MADE WITH 💖 BY : <Link href="https://www.ankith.dev" target="_blank" className=" text-blue-500 underline font-semibold">ANKITH</Link>
            </footer>
        </div>
    );
}