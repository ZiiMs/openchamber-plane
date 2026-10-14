// Checkable seam for issue #4: the extension installs iff the manifest parses
// and the panel script is a single classic IIFE bundle. Run: node check.mjs
import { readFileSync, existsSync } from "node:fs";
import { parseManifestJson } from "@openchamber/sdk/schemas";

const dir = new URL("./", import.meta.url);
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exitCode = 1; };
const ok = (msg) => console.log(`ok: ${msg}`);
const eq = (actual, expected, label) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(`${label}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  else ok(label);
};

const pkgPath = new URL("./package.json", dir);
if (!existsSync(pkgPath)) { fail("plane/package.json missing"); process.exit(1); }
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const parsed = parseManifestJson(JSON.stringify(pkg));
if (!parsed.ok) fail(`SDK parseManifestJson rejected manifest: ${parsed.code} ${parsed.message}`);
else ok("SDK parseManifestJson accepts manifest");
const oc = pkg.openchamber;
if (oc?.apiVersion !== 1) fail("openchamber.apiVersion must be 1"); else ok("apiVersion is 1");
const c = oc?.contributes ?? {};
for (const [path, label] of [
  [c.panel?.entry, "panel.entry"],
  [c.attach, "attach"],
  [c.integration?.oauth?.apiOrigin, "integration.oauth.apiOrigin"],
  [c.integration?.oauth?.authorizeUrl, "integration.oauth.authorizeUrl"],
  [c.integration?.oauth?.tokenUrl, "integration.oauth.tokenUrl"],
  [c.integration?.oauth?.account?.path, "integration.oauth.account.path"],
  [c.integration?.oauth?.account?.name, "integration.oauth.account.name"],
]) if (!path) fail(`contributes.${label} missing`); else ok(`contributes.${label} = ${path}`);
if (c.integration?.oauth?.apiOrigin !== "https://api.plane.so") fail("apiOrigin must be https://api.plane.so");
for (const s of ["read", "projects.work_items:read", "projects:read", "projects.states:read", "projects.members:read"])
  if (!c.integration?.oauth?.scopes?.includes(s)) fail(`oauth scope missing: ${s}`); else ok(`scope ${s}`);
for (const cap of ["prompt", "sessions"])
  if (!c.capabilities?.includes(cap)) fail(`capability missing: ${cap}`); else ok(`capability ${cap}`);
for (const id of ["workspace-slug", "default-project"])
  if (!c.integration?.settings?.some((f) => f.id === id)) fail(`settings field missing: ${id}`); else ok(`setting ${id}`);
if (!c.commands?.some((cmd) => cmd.name === "plane")) fail('slash command "plane" missing'); else ok('command "plane"');
if (c.page !== true) fail('contributes.page must be true (full-screen page reuses panel.entry)'); else ok('contributes.page reuses panel.entry');

const html = new URL("./panel/index.html", dir);
if (!existsSync(html)) fail("panel/index.html missing"); else ok("panel/index.html exists");
const js = new URL("./panel/main.js", dir);
if (!existsSync(js)) fail("panel/main.js missing (run the bundler)"); else {
  const src = readFileSync(js, "utf8");
  if (/^\s*(import|export)\s/m.test(src)) fail("panel/main.js must be a classic script, not an ES module");
  else ok("panel/main.js is a classic script");
  if (!src.includes("Not connected")) fail("panel/main.js missing not-connected empty state"); else ok("not-connected empty state present");
  for (const needle of [
    "state_group__in", // work-item list carries the state-group filter
    "assignee_id", // work-item list carries the assigned-to-me filter
    "/work-items/", // work-item list / by-identifier paths
    "users/me/workspaces", // opportunistic workspace auto-discovery path
    "Found workspaces", // discovered slugs offered in the no-slug empty state
    "/browse/", // rows link toward the canonical browse URL
    "Assigned to me", // assigned-to-me control
    "Load more", // paged lists
  ]) if (!src.includes(needle)) fail(`panel/main.js missing browse wiring: ${needle}`); else ok(`browse wiring present: ${needle}`);
  for (const needle of [
    "providerId", // chip carries the panel provider id
    "Attach chip", // attach action
    "Start session", // new-session action
    "Link to open session", // open-session link action
    "Open in Plane", // browse deep link moved behind selection
    "setBadge", // rail badge
    "sessionLink", // open-session link call
    "startSession", // new-session call
    "NO_SESSION", // clean link-without-session error
    "No open session", // human wording of that error
  ]) if (!src.includes(needle)) fail(`panel/main.js missing attach wiring: ${needle}`); else ok(`attach wiring present: ${needle}`);
  for (const needle of [
    "onResolve", // slash command answers instead of stubbing null
    "args", // resolve reads the command args for the work item identifier
    "plane.workspace-slug", // remembered workspace slug via host.storage cache
    "plane.default-project", // remembered default project via host.storage cache
  ]) if (!src.includes(needle)) fail(`panel/main.js missing command wiring: ${needle}`); else ok(`command wiring present: ${needle}`);
}

// --- Issue #5: pure browse-logic seam (no network) ---
// Expected values come from the issue + issue #3 spike notes, not from the code.
const browse = await import("./browse-logic.mjs").catch(() => null);
if (!browse) fail("plane/browse-logic.mjs missing");
else {
  eq(browse.projectsPath("acme"), "/api/v2/workspaces/acme/projects/", "projects path");
  eq(browse.workItemsPath("acme", "abc"), "/api/v2/workspaces/acme/projects/abc/work-items/", "work-items path");
  eq(browse.workItemByIdentifierPath("acme", "PROJ-118"), "/api/v2/workspaces/acme/work-items/PROJ-118/", "by-identifier path");
  eq(browse.isValidSlug("acme-1_2"), true, "slug accepts letters/digits/_/-");
  for (const bad of ["", "has space", "a/b", "a:b"]) eq(browse.isValidSlug(bad), false, `slug rejects ${JSON.stringify(bad)}`);
  eq(browse.isIdentifierQuery("PROJ-142"), true, "identifier query detected");
  for (const not of ["just words", "PROJ-", "142", "PROJ 142"]) eq(browse.isIdentifierQuery(not), false, `not an identifier: ${JSON.stringify(not)}`);
  eq(browse.browseUrl("acme", "PROJ-142"), "https://app.plane.so/acme/browse/PROJ-142/", "canonical browse URL");
  const base = browse.workItemsQuery({});
  eq(base.expand, "state,assignees", "query expands state+assignees");
  eq(typeof base.fields === "string" && base.fields.split(",").includes("state"), true, "query trims fields incl. state");
  eq(base.per_page, "25", "query pages at 25");
  eq("search" in base || "state_group__in" in base || "assignee_id" in base, false, "empty filters send no filter keys");
  const full = browse.workItemsQuery({ search: "api crash", stateGroup: "started", assigneeId: "u1", offset: "25" });
  eq([full.search, full.state_group__in, full.assignee_id, full.offset], ["api crash", "started", "u1", "25"], "query carries search/filter/offset");
  const off = browse.parseWorkItemsEnvelope({ data: [{ id: "a" }], next: 25, total_count: 60, pagination: { style: "offset" } });
  eq([off.items.length, off.page], [1, { kind: "offset", next: 25 }], "offset envelope page");
  eq(off.totalCount, 60, "offset envelope carries total_count for the badge");
  eq(browse.parseWorkItemsEnvelope({ data: [], next: null, total_count: 0, pagination: { style: "offset" } }).page, null, "offset envelope end");
  eq(browse.parseWorkItemsEnvelope({ data: [], next: null, total_count: 0, pagination: { style: "offset" } }).totalCount, 0, "offset envelope keeps a zero total_count");
  eq(browse.parseWorkItemsEnvelope({ data: [{ id: "a" }], next_cursor: "abc", has_more: true, pagination: { style: "cursor" } }).totalCount, null, "envelope without total_count yields null");
  const cur = browse.parseWorkItemsEnvelope({ data: [{ id: "a" }], next_cursor: "abc", has_more: true, pagination: { style: "cursor" } });
  eq([cur.items.length, cur.page], [1, { kind: "cursor", next: "abc" }], "cursor envelope page");
  eq(browse.parseWorkItemsEnvelope({ data: [], next_cursor: null, has_more: false, pagination: { style: "cursor" } }).page, null, "cursor envelope end");
  eq(browse.normalizeWorkItem({ id: "u", name: "Fix login", identifier: "ACME-7", state: { name: "In Progress", group: "started" } }),
    { id: "u", identifier: "ACME-7", title: "Fix login", state: "In Progress" }, "row shows identifier, title, state");
  eq(browse.normalizeWorkItem({ id: "u", name: "Sparse", state_id: "s1" }).state, "s1", "sparse state falls back to state_id");
  eq(browse.rateLimitDelayMs({ attempt: 0 }), 1000, "backoff base 1s");
  eq(browse.rateLimitDelayMs({ retryAfter: "2", attempt: 0 }), 2000, "Retry-After seconds honored");
  eq(browse.rateLimitDelayMs({ retryAfter: "garbage", attempt: 2 }), 4000, "bad Retry-After falls back to exponential");
  eq(browse.WORKSPACES_DISCOVERY_PATH, "/api/v1/users/me/workspaces/", "discovery path");
  eq(browse.parseDiscoveredWorkspaces([
    { id: "1", name: "Acme", slug: "acme" },
    { id: "2", name: "Web", slug: "web" },
    { name: "no slug" },
    { slug: "bad slug" },
    { slug: 42 },
  ]), ["acme", "web"], "discovery keeps valid slugs, drops the rest");
  for (const bad of [null, undefined, "nope", 42, {}, { detail: "Not found." }]) eq(browse.parseDiscoveredWorkspaces(bad), [], `discovery rejects ${JSON.stringify(bad)}`);
}
// --- Issue #6: pure attach-logic seam (no network, no SDK) ---
// Expected values come from the issue + host docs (API.md section 1.4:
// attach id<=128, title<=200, url<=2000; badge 0-999, null clears),
// not from the code.
const attach = await import("./attach-logic.mjs").catch(() => null);
if (!attach) fail("plane/attach-logic.mjs missing");
else {
  eq(attach.buildAttachItem({ slug: "acme", identifier: "PROJ-142", title: "Fix login" }),
    { providerId: "plane", id: "PROJ-142", title: "Fix login", url: "https://app.plane.so/acme/browse/PROJ-142/" },
    "chip carries provider, identifier, title, browse URL");
  eq(attach.buildAttachItem({ slug: "acme", identifier: "X".repeat(200), title: "t" }).id.length, 128, "chip id clamps to 128");
  eq(attach.buildAttachItem({ slug: "acme", identifier: "PROJ-1", title: "t".repeat(500) }).title.length, 200, "chip title clamps to 200");
  eq(attach.buildAttachItem({ slug: "acme", identifier: `P-${"1".repeat(3000)}`, title: "t" }).url.length, 2000, "chip url clamps to 2000");
  const sessionText = attach.buildSessionText({ identifier: "PROJ-142", title: "Fix login", url: "https://app.plane.so/acme/browse/PROJ-142/", state: "In Progress" });
  for (const needle of ["PROJ-142", "Fix login", "https://app.plane.so/acme/browse/PROJ-142/", "In Progress"])
    if (!sessionText.includes(needle)) fail(`session text carries ${needle}`);
    else ok(`session text carries ${needle}`);
  eq(attach.countOpenWorkItems([
    { state: { group: "started" } },
    { state: { group: "completed" } },
    { state: { group: "cancelled" } },
    { name: "sparse row" },
  ]), 2, "open count skips completed/cancelled, keeps unknown");
  eq(attach.badgeForOpenCount(false, 5), null, "badge clears when disconnected");
  eq(attach.badgeForOpenCount(true, 0), null, "badge clears when nothing open");
  eq(attach.badgeForOpenCount(true, 3), 3, "badge shows open count");
  eq(attach.badgeForOpenCount(true, 5000), 999, "badge clamps to 999");
  eq(attach.badgeForListResult(true, 60, 1), 60, "badge prefers total_count over loaded rows");
  eq(attach.badgeForListResult(true, null, 3), 3, "badge falls back to loaded rows without total_count");
  eq(attach.badgeForListResult(true, undefined, 3), 3, "badge falls back when total_count is missing");
  eq(attach.badgeForListResult(false, 60, 5), null, "list badge clears when disconnected");
  eq(attach.badgeForListResult(true, 0, 0), null, "list badge clears on zero total");
}
// --- Issue #7: pure resolve-logic seam (no network, no SDK) ---
// Expected values come from the issue + issue #3 spike notes (v2 direct GET
// …/work-items/{identifier}/, unknown identifiers resolve to null), not
// from the code.
const resolveLogic = await import("./resolve-logic.mjs").catch(() => null);
if (!resolveLogic) fail("plane/resolve-logic.mjs missing");
else {
  eq(resolveLogic.parseCommandArgs("PROJ-142"), "PROJ-142", "command arg takes the identifier");
  eq(resolveLogic.parseCommandArgs("  PROJ-142  "), "PROJ-142", "command arg trims whitespace");
  eq(resolveLogic.parseCommandArgs("PROJ-142 extra words"), "PROJ-142", "command arg reads the first token");
  eq(resolveLogic.parseCommandArgs("proj-7"), "proj-7", "command arg keeps the typed case");
  for (const bad of ["", "   ", "just words", "PROJ-", "142", "PROJ 142", "attach PROJ-142"]) eq(resolveLogic.parseCommandArgs(bad), null, `command arg rejects ${JSON.stringify(bad)}`);
  for (const bad of [undefined, null, 123, {}, []]) eq(resolveLogic.parseCommandArgs(bad), null, `command arg rejects non-string ${JSON.stringify(bad)}`);
  eq(resolveLogic.resolveWorkItem({ id: "u", name: "Fix login", identifier: "PROJ-142", state: { name: "In Progress", group: "started" } }),
    { id: "u", identifier: "PROJ-142", title: "Fix login", state: "In Progress" }, "resolve unwraps a bare work item");
  eq(resolveLogic.resolveWorkItem({ data: [{ id: "u", name: "Fix login", identifier: "PROJ-142", state: { name: "Todo", group: "unstarted" } }] })?.identifier,
    "PROJ-142", "resolve unwraps a {data:[…]} envelope");
  eq(resolveLogic.resolveWorkItem({ data: { id: "u", name: "Fix login", identifier: "PROJ-142" } })?.identifier,
    "PROJ-142", "resolve unwraps a {data:{…}} envelope");
  for (const bad of [null, undefined, "nope", 42, [], { data: [] }, {}, { name: "no ids" }]) eq(resolveLogic.resolveWorkItem(bad), null, `resolve rejects ${JSON.stringify(bad)}`);
}
// --- Issue #7: pure mapping-logic seam (no SDK) ---
// Read-through per the issue: settings win, host.storage fills blanks.
const mapping = await import("./mapping-logic.mjs").catch(() => null);
if (!mapping) fail("plane/mapping-logic.mjs missing");
else {
  eq(mapping.MAPPING_STORAGE_KEYS, { slug: "plane.workspace-slug", defaultProject: "plane.default-project" }, "mapping storage keys");
  eq(mapping.mergeMapping({ slug: "acme", defaultProject: "web" }, { slug: "old", defaultProject: "old" }),
    { slug: "acme", defaultProject: "web" }, "settings win over stored values");
  eq(mapping.mergeMapping({ slug: "", defaultProject: "" }, { slug: "acme", defaultProject: "web" }),
    { slug: "acme", defaultProject: "web" }, "stored values fill blank settings");
  eq(mapping.mergeMapping({ slug: "acme", defaultProject: "" }, { slug: "old", defaultProject: "web" }),
    { slug: "acme", defaultProject: "web" }, "merge works per field");
  eq(mapping.mergeMapping({ slug: "  acme  ", defaultProject: "" }, {}),
    { slug: "acme", defaultProject: "" }, "merge trims and tolerates missing stored mapping");
  eq(mapping.mergeMapping(), { slug: "", defaultProject: "" }, "merge tolerates missing inputs");
}
if (process.exitCode) console.error("CHECK FAILED"); else console.log("CHECK PASSED");
