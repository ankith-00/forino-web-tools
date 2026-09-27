// Temporary: snapshot + compare the confirmation email so the shared-shell
// refactor can be proven byte-identical in output. Run:
//   node probe-email.mjs save    (before refactor)
//   node probe-email.mjs check   (after refactor)
import fs from "node:fs";

const { confirmEmail } = await import("./src/lib/email/templates/confirm-email.ts");
const SNAP = "confirm-snapshot.json";

const cases = {
    plain: { confirmUrl: "https://x.test/api/auth/confirm?token_hash=abc&type=signup", displayName: null },
    named: { confirmUrl: "https://x.test/api/auth/confirm?token_hash=abc&type=signup", displayName: "Ada Lovelace" },
    // Hostile inputs: the name is user-supplied and lands in the greeting, and
    // the URL lands in both an href and the visible text.
    xss: { confirmUrl: 'https://x.test/?a=1&b="2"', displayName: "<script>alert(1)</script>" },
    quote: { confirmUrl: "https://x.test/?q='x'", displayName: "O'Brien & Sons <Admin>" },
    blank: { confirmUrl: "https://x.test/", displayName: "   " },
};

const rendered = {};
for (const [k, v] of Object.entries(cases)) rendered[k] = confirmEmail(v);

const mode = process.argv[2];

/**
 * Normalize for structural comparison. The pre-refactor template wrapped some
 * copy across source lines (e.g. "...no account\n   will be activated.") and
 * spread one tag's attributes over several lines (e.g. "<td\n align=...").
 * Both are incidental authoring whitespace with no effect on rendering, so
 * comparing raw bytes would flag differences that cannot be seen in a mail
 * client. This normalizes text-node whitespace and intra-tag whitespace, then
 * compares — which still catches any change to tags, attributes or copy.
 */
const normTag = (t) => t.replace(/\s+/g, " ").replace(/\s+>/g, ">").replace(/<\s+/g, "<");
/**
 * Quote entities are equivalent to the literal characters when rendered, and the
 * refactor made `note()` escape its input (it must, the invite template puts a
 * user-supplied name there). So decode only the quote entities in text nodes.
 * `&amp;`, `&lt;` and `&gt;` are deliberately left encoded so that an injection
 * regression still fails section B; section E re-checks escaping independently.
 */
const normText = (t) =>
    t.replace(/\s+/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
const norm = (h) =>
    h
        .split(/(<[^>]*>)/) // keep tags separate from the text between them
        .map((part) => (part.startsWith("<") ? normTag(part) : normText(part)))
        .join("")
        .replace(/>\s+</g, "><")
        .trim();
const tagList = (s) => (s.match(/<[a-zA-Z/][^>]*>/g) ?? []).map(normTag).sort();

if (mode === "save") {
    fs.writeFileSync(SNAP, JSON.stringify(rendered, null, 2));
    console.log(`saved ${Object.keys(rendered).length} cases -> ${SNAP} (${fs.statSync(SNAP).size} bytes)`);
} else if (mode === "check") {
    if (!fs.existsSync(SNAP)) {
        console.log("FAIL no snapshot - run `node probe-email.mjs save` first");
        process.exit(1);
    }
    const before = JSON.parse(fs.readFileSync(SNAP, "utf8"));
    let bad = 0;

    console.log("A. subject must be byte-exact");
    for (const k of Object.keys(before)) {
        const a = before[k].subject;
        const b = rendered[k]?.subject;
        if (a === b) console.log(`   PASS ${k} (${a.length} chars)`);
        else {
            bad++;
            console.log(`   FAIL ${k}\n        before ${JSON.stringify(a)}\n        after  ${JSON.stringify(b)}`);
        }
    }

    console.log("\nB. html must be structurally identical (whitespace-normalised)");
    for (const k of Object.keys(before)) {
        const a = norm(before[k].html);
        const b = norm(rendered[k]?.html ?? "");
        if (a === b) {
            const rawDelta = Math.abs(before[k].html.length - (rendered[k]?.html.length ?? 0));
            console.log(`   PASS ${k} (raw byte delta ${rawDelta}, ignored whitespace only)`);
        } else {
            bad++;
            let i = 0;
            while (i < a.length && i < b.length && a[i] === b[i]) i++;
            console.log(`   FAIL ${k}  first structural diff at ${i}`);
            console.log(`        before: ${JSON.stringify(a.slice(Math.max(0, i - 70), i + 70))}`);
            console.log(`        after : ${JSON.stringify(b.slice(Math.max(0, i - 70), i + 70))}`);
        }
    }

    console.log("\nC. tag and attribute inventory must match exactly");
    for (const k of Object.keys(before)) {
        const a = tagList(before[k].html);
        const b = tagList(rendered[k]?.html ?? "");
        if (JSON.stringify(a) === JSON.stringify(b)) console.log(`   PASS ${k} (${a.length} tags)`);
        else {
            bad++;
            console.log(`   FAIL ${k}: before ${a.length} tags, after ${b.length}`);
            const onlyA = a.filter((t) => !b.includes(t));
            const onlyB = b.filter((t) => !a.includes(t));
            if (onlyA.length) console.log(`        lost : ${onlyA.join(" ")}`);
            if (onlyB.length) console.log(`        added: ${onlyB.join(" ")}`);
        }
    }

    console.log("\nD. the one intentional change: text part now matches the HTML");
    // Pre-refactor, the HTML footer read "This confirmation link expires in 24
    // hours..." while the plain-text part read "This link expires in 24
    // hours...". Sharing one constant unified them. Assert the exact intended
    // wording rather than letting it pass silently.
    const EXPECT = "This confirmation link expires in 24 hours and can only be used once.";
    for (const k of Object.keys(before)) {
        const t = rendered[k]?.text ?? "";
        const hasNew = t.includes(EXPECT);
        const hasOld = t.includes("This link expires in 24 hours");
        if (hasNew && !hasOld) console.log(`   PASS ${k} text carries the unified expiry wording`);
        else {
            bad++;
            console.log(`   FAIL ${k} (new wording present: ${hasNew}, old wording still present: ${hasOld})`);
        }
    }
    // Everything else in the text part must be untouched.
    for (const k of Object.keys(before)) {
        const strip = (s) => s.replace(EXPECT, "This link expires in 24 hours and can only be used once.");
        if (strip(rendered[k]?.text ?? "") === before[k].text) console.log(`   PASS ${k} text otherwise unchanged`);
        else {
            bad++;
            console.log(`   FAIL ${k} text has changes beyond the expiry wording`);
        }
    }

    console.log("\nE. re-assert escaping on the refactored output (not inherited from the snapshot)");
    const xssHtml = rendered.xss.html;
    console.log(`   ${!xssHtml.includes("<script>") ? "PASS" : "FAIL"} no raw <script> injected into html`);
    console.log(`   ${xssHtml.includes("&lt;script&gt;") ? "PASS" : "FAIL"} script tag present but escaped`);
    console.log(`   ${!rendered.quote.html.includes("O'Brien") ? "PASS" : "FAIL"} apostrophe escaped in html`);
    const href = xssHtml.match(/href="([^"]*)"/)?.[1] ?? "";
    console.log(`   ${!href.includes('b="2"') ? "PASS" : "FAIL"} double quote escaped inside href (got ${JSON.stringify(href)})`);
    console.log(`   ${!rendered.xss.text.includes("<script>") ? "PASS" : "FAIL"} text part not used as html`);

    console.log(`\nRESULT: ${bad === 0 ? "no unintended change" : bad + " PROBLEMS"}`);
    process.exit(bad === 0 ? 0 : 1);
} else {
    console.log("usage: node probe-email.mjs save|check");
    process.exit(2);
}
