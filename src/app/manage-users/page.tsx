import { redirect } from "next/navigation";
import Navbar from "@/components/layout/Navbar";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { createClient } from "@/utils/supabase/server";
import { isAdmin } from "@/lib/access";
import { listUsers } from "@/lib/admin";
import { fetchPublicTools } from "@/lib/public-tools";
import { listInvites } from "@/lib/invites";
import type { Invite } from "@/lib/invite-shared";
import UsersTable from "./users-table";
import InviteUser from "./invite-user";

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
    // Only used by the subheading, which is commented out in the markup below.
    // const adminCount = users.filter((u) => u.role === "admin").length;
    const nonAdmins = users.filter((u) => u.role !== "admin");
    const publicTools = await fetchPublicTools(supabase);

    // Invitations are shown on their own tab. Loaded separately and defensively:
    // if the migration hasn't been applied the users list is still perfectly
    // usable, so a failure here must not take the whole page down with it.
    let invites: Invite[] = [];
    let inviteLoadError: string | null = null;
    try {
        invites = await listInvites();
    } catch (e) {
        inviteLoadError = e instanceof Error ? e.message : "Failed to load invitations.";
    }

    // An invitation that has been accepted is no longer an open question: the
    // invitee has a real account, so `listUsers` already reports them and they
    // belong in the Active Users tab. Keeping the spent row in Invites would show
    // the same person twice, once without the tool controls they actually need.
    const openInvites = invites.filter((i) => i.status !== "accepted");

    return (
        <div className="flex min-h-svh flex-col bg-background font-sans text-foreground">
            <Navbar />
            <main className="mx-auto w-full max-w-6xl flex-1 px-6 pb-6 pt-8">
                {/* Title and the Invite button share one row, so the button never
                    drops below the heading at a narrow width. */}
                <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-3 sm:gap-4">
                        <h1 className="text-2xl font-semibold">Manage Users</h1>
                        <InviteUser publicTools={publicTools} />
                    </div>
                    {/* Subheading is currently disabled. `adminCount` above is
                        commented out with it so it doesn't read as unused. Uncomment
                        both to restore.
                    <p className="text-xs text-muted-foreground sm:text-sm">
                        Grant or revoke tool access for each user.{adminCount > 0 && ` ${adminCount} admin${adminCount > 1 ? "s" : ""} on this team.`}
                    </p>
                    */}
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
                    <UsersTable
                        users={nonAdmins}
                        publicTools={publicTools}
                        invites={openInvites}
                        inviteLoadError={inviteLoadError}
                    />
                )}
            </main>
            <SiteFooter />
        </div>
    );
}