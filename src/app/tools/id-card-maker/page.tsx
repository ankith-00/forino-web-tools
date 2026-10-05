import { notFound, redirect } from "next/navigation";
import { requireToolAccess } from "@/lib/access-server";

/**
 * ID Card Maker — placeholder route.
 *
 * Replaced the previous "ANKITH is working on it" card with `notFound()`, so this
 * hands off to the root 404 (see `src/app/not-found.tsx`) and returns a real 404
 * status. The entry stays in `TOOLS` so the card still shows on the dashboard and
 * admins can still grant or publish access ahead of the build.
 *
 * The access check stays for the same reason as `magic-frame`: the proxy redirect is
 * optimistic, and this re-verifies server-side.
 */
export default async function IdCardPage() {
    const { granted } = await requireToolAccess("id-card");
    if (!granted) {
        redirect("/dashboard");
    }

    notFound();
}