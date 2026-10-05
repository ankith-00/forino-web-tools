import { redirect } from "next/navigation";

/**
 * `/` used to re-export the login page directly, which meant two URLs rendering
 * the same form and two cache entries to keep in step. A redirect gives one
 * canonical signed-out entry point.
 *
 * Signed-in users are not bounced to /login from here; the proxy and the
 * dashboard handle that, so this stays a plain redirect.
 */
export default function HomePage() {
    redirect("/login");
}
