import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getServiceClient, listUsers, displayNamesById } from "@/lib/admin";
import { canAccessTool, mergeToolAccess, userAccess } from "@/lib/access";
import { fetchPublicTools } from "@/lib/public-tools";
import Navbar from "@/components/layout/Navbar";
import { AttendanceRecordsClient } from "@/components/tools/AttendanceRecordsClient";
import type { AnswerBooklet } from "@/components/tools/AttendanceRecordsClient";

/** Newest first on both tabs. The limits bound the page: an institution with a
 *  few thousand scans should page through the server, not receive all of them. */
const ROW_LIMIT = 300;

async function getRecords() {
    const admin = getServiceClient();

    const { data: attendance, error: attendanceError } = await admin
        .from("attendance")
        .select("*")
        .order("marked_at", { ascending: false })
        .limit(ROW_LIMIT);

    // Scanned booklets are loaded separately and defensively, like the invite
    // list on the admin page: if their migration has not been applied the
    // attendance tab must still be fully usable, so a failure here is reported
    // inside the booklets tab rather than taking the page down.
    let booklets: AnswerBooklet[] = [];
    let bookletLoadError: string | null = null;
    try {
        const { data, error } = await admin
            .from("answer_booklets")
            .select("*")
            .order("uploaded_at", { ascending: false })
            .limit(ROW_LIMIT);
        if (error) throw error;
        booklets = data ?? [];
    } catch (e) {
        console.error("[attendance-records] Booklet fetch failed:", e);
        bookletLoadError =
            e instanceof Error
                ? e.message
                : "Failed to load scanned booklets.";
    }

    if (attendanceError) {
        console.error("[attendance-records] Attendance fetch error:", attendanceError.message);
    }

    // `marked_by` and `uploaded_by` are bare uuids into auth.users, so they have to
    // be resolved to a name before either table can show anything useful. A failure
    // here costs the columns their labels but not the records, so it must not take
    // the page down with it.
    let userNames: Record<string, string> = {};
    try {
        userNames = displayNamesById(await listUsers());
    } catch (e) {
        console.error("[attendance-records] Could not resolve marker names:", e);
    }

    return {
        records: attendance ?? [],
        booklets,
        bookletLoadError,
        userNames,
    };
}

export default async function AttendanceRecordsPage() {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect("/login");

    const publicTools = await fetchPublicTools(supabase);
    const access = mergeToolAccess(userAccess(user), publicTools);
    if (!canAccessTool(access, "attendance-records")) {
        redirect("/dashboard");
    }

    const { records, booklets, bookletLoadError, userNames } = await getRecords();

    return (
        <>
            <Navbar />
            <AttendanceRecordsClient
                attendance={records}
                booklets={booklets}
                bookletLoadError={bookletLoadError}
                userNames={userNames}
            />
        </>
    );
}
