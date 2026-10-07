import { notFound, redirect } from "next/navigation";
import { requireToolAccess } from "@/lib/access-server";

/**
 * Magic Frame — placeholder route.
 *
 * The tool is listed in `TOOLS` so its card appears on the dashboard and so admins
 * can grant, block or publish access to it before it is built, but there is nothing
 * behind the page yet. `notFound()` hands off to the root 404 (see
 * `src/app/not-found.tsx`) and returns a real 404 status, which is what this route
 * actually is. Deleting this file later is all it takes to swap in the real tool.
 *
 * The access check stays. The proxy already bounces users who lack the grant, but
 * that is an optimistic redirect; `requireToolAccess` re-verifies server-side, and
 * without it this route would serve its 404 to anyone with a valid session.
 */
export default async function MagicFramePage() {
    const { granted } = await requireToolAccess("magic-frame");
    if (!granted) {
        redirect("/dashboard");
    }

    notFound();
}