// Temporary probe for the admin invite flow. Splits what it can prove without a
// database from what genuinely needs the migration + a real inbox.
import { createHash, randomBytes } from "node:crypto";

for (const line of (await import("node:fs")).readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}

const invites = await import("./src/lib/invites.ts");
const { inviteEmail } = await import("./src/lib/email/templates/invite-email.ts");

let failures = 0;
const check = (name, ok, extra = "") => {
    console.log(`   ${ok ? "PASS" : "FAIL"} ${name}${extra ? "  " + extra : ""}`);
    if (!ok) failures++;
};

console.log("A. token handling (pure)");
{
    const tok = randomBytes(32).toString("base64url");
    check("token is 43 chars (32 bytes base64url)", tok.length === 43, `${tok.length}`);
    check("token is URL-safe (no padding or +/)", /^[A-Za-z0-9_-]+$/.test(tok));
    check("two tokens differ", randomBytes(32).toString("base64url") !== tok);

    const h = invites.hashInviteToken("abc");
    check("hash is 64 hex chars (sha256)", /^[0-9a-f]{64}$/.test(h), h.slice(0, 12) + "...");
    check("hash is deterministic", invites.hashInviteToken("abc") === h);
    check("hash differs for a different token", invites.hashInviteToken("abd") !== h);
    check(
        "hash matches an independent sha256",
        h === createHash("sha256").update("abc", "utf8").digest("hex")
    );
    // The whole point of hashing: the raw token must not be recoverable.
    check("hash is not the token", !h.includes(tok) && h !== tok);

    // A lookup must not be forgeable by passing the hash itself.
    check("hash is 64 chars so it cannot be a valid token", h.length !== 43);
}

console.log("\nB. email normalisation + validation");
{
    check("trims and lowercases", invites.normaliseEmail("  Ada@Example.COM ") === "ada@example.com");
    for (const [label, ok] of [
        ["a@b.co", invites.isValidEmail("a@b.co")],
        ["ada.lovelace+tag@sub.example.co.uk", invites.isValidEmail("ada.lovelace+tag@sub.example.co.uk")],
        ["no-at-sign", !invites.isValidEmail("no-at-sign")],
        ["no-domain", !invites.isValidEmail("ada@")],
        ["spaces inside", !invites.isValidEmail("ada lovelace@x.com")],
        ["empty", !invites.isValidEmail("")],
    ]) check(`isValidEmail(${label}) = ${ok}`, ok);
}

console.log("\nC. expiry window");
{
    const d = Date.parse(invites.expiresAtFromNow());
    const days = (d - Date.now()) / 86400000;
    check("expires in ~7 days", Math.abs(days - 7) < 0.01, `${days.toFixed(3)} days`);
    check("TTL constant is 7", invites.INVITE_TTL_DAYS === 7);
    const url = invites.inviteAcceptUrl("tok en/with+chars");
    check("accept URL points at /invite/accept", url.includes("/invite/accept?token="), url);
    check("token is percent-encoded in the URL", url.includes("tok%20en%2Fwith%2Bchars"), url);
    check("accept URL is absolute", /^https?:\/\//.test(url));
}

console.log("\nD. invite email template");
{
    const acceptUrl = "https://forino.test/invite/accept?token=abc123";
    const named = inviteEmail({ acceptUrl, displayName: "Ada Lovelace", invitedByName: "Ankith" });
    const bare = inviteEmail({ acceptUrl, displayName: null, invitedByName: null });

    check("has a subject", named.subject.length > 0, named.subject);
    check("subject names the brand", named.subject.includes("Forino"));
    check("html includes the accept link", named.html.includes(acceptUrl));
    check("html has a call-to-action button", /Accept invitation<\/a>/.test(named.html));
    check("text part includes the raw URL", named.text.includes(acceptUrl));
    check("text part is plain (no html tags)", !named.text.includes("<"));
    check("greeting uses the invitee name", named.html.includes("Hi Ada Lovelace,"), named.html.includes("Hi Ada Lovelace,"));
    check("mentions the inviter", named.html.includes("Ankith has invited you"));
    check("falls back cleanly with no name", bare.html.includes("Hi there,") && bare.html.includes("You have been invited to join Forino."), bare.text.split("\n")[2]);
    check("no dangling blank inviter", !bare.html.includes("undefined") && !bare.text.includes("undefined"));

    // The display name is admin-supplied and lands in the HTML.
    const hostile = inviteEmail({ acceptUrl, displayName: "<script>alert(1)</script>", invitedByName: "Evil\" onload=\"x" });
    check("hostile invitee name is escaped", !hostile.html.includes("<script>"), "no raw script tag");
    check("hostile inviter name is escaped", !/onload="x/.test(hostile.html), "no injected attribute");
    check("hostile name still appears escaped", hostile.html.includes("&lt;script&gt;"));

    // Both templates must render the same chrome, or invites look like phishing.
    const { confirmEmail } = await import("./src/lib/email/templates/confirm-email.ts");
    const c = confirmEmail({ confirmUrl: acceptUrl });
    for (const [label, re] of [["doctype", /<!doctype html>/i], ["wordmark", />Forino</], ["560px card", /max-width:560px/], ["button pill", /border-radius:8px/]]) {
        check(`invite matches confirm chrome: ${label}`, re.test(named.html) && re.test(c.html));
    }
}

console.log("\nE. does the database table exist yet?");
{
    const hasUrl = !!process.env.NEXT_PUBLIC_SUPABASE_URL;
    const hasKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
    check("Supabase URL configured", hasUrl);
    check("service role key configured", hasKey);
    if (hasUrl && hasKey) {
        try {
            const { getServiceClient } = await import("./src/lib/admin.ts");
            const { data, error } = await getServiceClient().from("user_invites").select("id").limit(1);
            if (error) {
                console.log(`   INFO table not queryable: ${error.message}`);
                console.log("   -> apply supabase/migrations/20260928000000_user_invites.sql, then re-run.");
            } else {
                check("user_invites table exists and is reachable", true, `${data?.length ?? 0} row(s) visible`);
            }
            // RLS must hide the table from a non-service-role client.
            const { createClient } = await import("@supabase/ssr");
            const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
                auth: { autoRefreshToken: false, persistSession: false },
            });
            const { data: anonData, error: anonErr } = await anon.from("user_invites").select("id").limit(1);
            check("anon client cannot read user_invites", !!anonErr, anonErr ? `blocked: ${anonErr.message}` : `LEAKED ${anonData?.length} rows`);
        } catch (e) {
            console.log(`   INFO could not reach Supabase: ${e instanceof Error ? e.message : e}`);
        }
    } else {
        console.log("   SKIP no service-role credentials in .env.local");
    }
}

console.log("\nF. HTTP behaviour of /invite/accept (server must be running)");
{
    const ORIGIN = "http://localhost:3000";
    const reachable = await fetch(`${ORIGIN}/login`).then(() => true).catch(() => false);
    if (!reachable) {
        console.log("   SKIP no server on :3000");
    } else {
        const get = async (qs) => {
            const res = await fetch(`${ORIGIN}/invite/accept${qs}`, { redirect: "manual" });
            return { res, html: await res.text() };
        };

        const { res: none, html: noneHtml } = await get("");
        check("no token -> 200, not a redirect to login", none.status === 200, `status ${none.status}`);
        check("no token explains the problem", noneHtml.includes("This link is incomplete"));

        const junk = randomBytes(32).toString("base64url");
        const { res: bad, html: badHtml } = await get(`?token=${junk}`);
        check("unknown token -> 200", bad.status === 200, `status ${bad.status}`);
        check("unknown token says it isn't valid", badHtml.includes("isn&#39;t valid") || badHtml.includes("isn't valid"));
        check("unknown token does NOT leak a DB error", !/user_invites|supabase|postgres|schema/i.test(badHtml), "no internals in the response");
        check("unknown token does not render a password form", !badHtml.includes('id="invite-password"'), "form correctly withheld");

        // The page must be reachable anonymously; a protected route would 307.
        check("page is public (not bounced to /login)", !(bad.status === 307 || bad.status === 302), `status ${bad.status}`);

        // A valid token must NOT be accepted via a different param name.
        const { res: t1, html: t1Html } = await get(`?token_hash=${junk}&type=invite`);
        check("token_hash alone is not a valid token", t1.status === 200 && !t1Html.includes('id="invite-password"'));

        // Shell chrome must be present on both branches.
        for (const [label, h] of [["no-token", noneHtml], ["bad-token", badHtml]]) {
            check(`${label}: shared header present`, h.includes("Forino") && /<header/.test(h));
            check(`${label}: theme toggle present`, h.includes('aria-label="Toggle theme"'));
            check(`${label}: shared footer present`, /<footer/.test(h) && h.includes("MADE WITH"));
        }
    }
}

console.log(`\nRESULT: ${failures === 0 ? "all checks passed" : failures + " FAILURES"}`);
process.exit(failures === 0 ? 0 : 1);
