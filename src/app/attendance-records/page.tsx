import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getServiceClient } from "@/lib/admin";
import { canAccessTool, mergeToolAccess, userAccess } from "@/lib/access";
import { fetchPublicTools } from "@/lib/public-tools";
import Navbar from "@/components/Navbar";
import { AttendanceRecordsClient } from "@/components/AttendanceRecordsClient";

async function getAttendanceData() {
    try {
        const admin = getServiceClient();
        const { data, error } = await admin
            .from("attendance")
            .select("*")
            .order("marked_at", { ascending: false })
            .limit(300);

        if (error) {
            console.error("[attendance-records] Attendance fetch error:", error.message);
            return [];
        }
        return data ?? [];
    } catch (e) {
        console.error("[attendance-records] Attendance query exception:", e);
        return [];
    }
}

async function getAnswerBooklets() {
    try {
        const admin = getServiceClient();
        const { data, error } = await admin
            .from("answer_booklets")
            .select("*")
            .order("uploaded_at", { ascending: false })
            .limit(300);

        if (error) {
            console.error("[attendance-records] Answer booklets fetch error:", error.message);
            return [];
        }
        return data ?? [];
    } catch (e) {
        console.error("[attendance-records] Answer booklets query exception:", e);
        return [];
    }
}

export default async function AttendanceRecordsPage() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect("/login");

    const publicTools = await fetchPublicTools(supabase);
    const access = mergeToolAccess(userAccess(user), publicTools);
    if (!canAccessTool(access, "attendance-records")) {
        redirect("/dashboard");
    }

    const [attendance, answerBooklets] = await Promise.all([
        getAttendanceData(),
        getAnswerBooklets(),
    ]);

    return (
        <>
            <Navbar />
            <AttendanceRecordsClient
                attendance={attendance}
                answerBooklets={answerBooklets}
                userId={user.id}
            />
        </>
    );
}