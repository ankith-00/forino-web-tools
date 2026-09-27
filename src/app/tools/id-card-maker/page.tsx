import { redirect } from "next/navigation";
import Link from "next/link";
import Navbar from "@/components/layout/Navbar";
import { requireToolAccess } from "@/lib/access-server";
import { HiOutlineUser } from "react-icons/hi";

export default async function IdCardPage() {
    const { granted } = await requireToolAccess("id-card");
    if (!granted) {
        redirect("/dashboard");
    }

    return (
        <div className="flex min-h-svh flex-col bg-background font-sans text-foreground">
            <Navbar />
            <main className="flex flex-1 items-center justify-center px-6">
                <div className="w-full max-w-sm rounded-[1em] border border-border bg-card p-6 text-center shadow-sm">
                    <div className="mb-3 flex justify-center text-primary">
                        <HiOutlineUser size={32} />
                    </div>
                    <h1 className="text-xl font-semibold">ID Card Maker</h1>
                    <p className="mt-2 text-sm text-muted-foreground">
                        ANKITH is working on it — stay tuned!
                    </p>
                    <Link
                        href="/dashboard"
                        className="mt-4 inline-flex items-center justify-center rounded-[0.8em] bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                    >
                        Back to Tools
                    </Link>
                </div>
            </main>
        </div>
    );
}