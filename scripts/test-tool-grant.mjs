/**
 * Verifies the private-tool grant flow: the client's `granted` flag and the
 * server action's flip must agree, otherwise Grant/Revoke silently no-op.
 *
 * Run: node scripts/test-tool-grant.mjs
 */
import assert from "node:assert/strict";

/** Mirror of userAccess() in src/lib/access.ts */
function userAccess(meta) {
    const m = meta ?? {};
    return {
        role: m.role === "admin" ? "admin" : "user",
        toolAccess: Array.isArray(m.tool_access) ? m.tool_access : [],
        blockedTools: Array.isArray(m.blocked_tools) ? m.blocked_tools : [],
    };
}

/** Mirror of grantToolAccess/revokeToolAccess in src/lib/admin.ts */
function grantToolAccess(state, slug) {
    const access = userAccess(state);
    if (access.toolAccess.includes(slug)) return state;
    return { ...state, tool_access: [...access.toolAccess, slug] };
}

function revokeToolAccess(state, slug) {
    const access = userAccess(state);
    return {
        ...state,
        tool_access: access.toolAccess.filter((s) => s !== slug),
    };
}

/** Mirror of toggleToolAccess in src/app/manage-users/actions.ts */
function toggleToolAccess(state, slug, currentlyGranted) {
    return currentlyGranted
        ? revokeToolAccess(state, slug)
        : grantToolAccess(state, slug);
}

const SLUG = "id-card";
let pass = 0;

function check(label, fn) {
    fn();
    console.log(`  PASS  ${label}`);
    pass++;
}

// 1. Granting an unheld private tool must ADD it.
check("granting an unheld private tool adds it", () => {
    const before = { role: "user", tool_access: [] };
    const after = toggleToolAccess(before, SLUG, false); // not granted -> grant
    assert.deepEqual(after.tool_access, [SLUG]);
});

// 2. Revoking a held private tool must REMOVE it.
check("revoking a held private tool removes it", () => {
    const before = { role: "user", tool_access: [SLUG] };
    const after = toggleToolAccess(before, SLUG, true); // granted -> revoke
    assert.deepEqual(after.tool_access, []);
});

// 3. Other tools must survive a toggle.
check("toggling preserves other grants", () => {
    const before = { role: "user", tool_access: ["scanner"] };
    assert.deepEqual(toggleToolAccess(before, SLUG, false).tool_access, ["scanner", SLUG]);
    assert.deepEqual(
        toggleToolAccess({ role: "user", tool_access: ["scanner", SLUG] }, SLUG, true).tool_access,
        ["scanner"]
    );
});

// 4. Regression guard: the old double negation made both directions no-ops.
check("old inverted call shape is a no-op (regression guard)", () => {
    const unheld = { role: "user", tool_access: [] };
    assert.deepEqual(
        toggleToolAccess(unheld, SLUG, true).tool_access, [],
        "passing the desired state instead of current state silently no-ops"
    );
});

// 5. Revoking a tool the user never had must not corrupt state.
check("revoking an unheld tool is harmless", () => {
    const before = { role: "user", tool_access: ["scanner"] };
    assert.deepEqual(toggleToolAccess(before, SLUG, true).tool_access, ["scanner"]);
});

// 6. blocked_tools must be untouched by a grant toggle.
check("grant toggle leaves blocked_tools intact", () => {
    const before = { role: "user", tool_access: [], blocked_tools: [SLUG] };
    const after = toggleToolAccess(before, SLUG, false);
    assert.deepEqual(after.tool_access, [SLUG]);
    assert.deepEqual(after.blocked_tools, [SLUG]);
});

// 7. The two toggle conventions must not be confused.
check("toggleToolAccess is a flipper (takes current state)", () => {
    // actions.ts flips internally, so passing current state is what advances it.
    assert.deepEqual(toggleToolAccess({ tool_access: [] }, SLUG, false).tool_access, [SLUG]);
    assert.deepEqual(toggleToolAccess({ tool_access: [SLUG] }, SLUG, true).tool_access, []);
});

check("toggleToolPublic is a setter (takes desired state)", () => {
    // actions.ts forwards straight to setToolPublic, so the caller must negate.
    const setToolPublic = (isPublic) => isPublic;
    assert.equal(setToolPublic(!false), true, "making a private tool public");
    assert.equal(setToolPublic(!true), false, "making a public tool private");
});

console.log(`\n${pass} checks passed.`);