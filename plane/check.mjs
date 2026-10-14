// Checkable seam for ticket #4: the extension installs iff the manifest parses
// and the panel script is a single classic IIFE bundle. Run: node check.mjs
import { readFileSync, existsSync } from "node:fs";
import { parseManifestJson } from "@openchamber/sdk/schemas";

const dir = new URL("./", import.meta.url);
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exitCode = 1; };
const ok = (msg) => console.log(`ok: ${msg}`);

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
}

// --- Ticket #5: pure browse-logic seam (no network) ---
// Expected values come from the ticket + #3 spike notes, not from the code.
const browse = await import("./browse-logic.mjs").catch(() => null);
if (!browse) fail("plane/browse-logic.mjs missing");
else {
  const eq = (actual, expected, label) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(`${label}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
    else ok(label);
  };
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
  eq(browse.parseWorkItemsEnvelope({ data: [], next: null, total_count: 0, pagination: { style: "offset" } }).page, null, "offset envelope end");
  const cur = browse.parseWorkItemsEnvelope({ data: [{ id: "a" }], next_cursor: "abc", has_more: true, pagination: { style: "cursor" } });
  eq([cur.items.length, cur.page], [1, { kind: "cursor", next: "abc" }], "cursor envelope page");
  eq(browse.parseWorkItemsEnvelope({ data: [], next_cursor: null, has_more: false, pagination: { style: "cursor" } }).page, null, "cursor envelope end");
  eq(browse.normalizeWorkItem({ id: "u", name: "Fix login", identifier: "ACME-7", state: { name: "In Progress", group: "started" } }),
    { id: "u", identifier: "ACME-7", title: "Fix login", state: "In Progress" }, "row shows identifier, title, state");
  eq(browse.normalizeWorkItem({ id: "u", name: "Sparse", state_id: "s1" }).state, "s1", "sparse state falls back to state_id");
  eq(browse.rateLimitDelayMs({ attempt: 0 }), 1000, "backoff base 1s");
  eq(browse.rateLimitDelayMs({ retryAfter: "2", attempt: 0 }), 2000, "Retry-After seconds honored");
  eq(browse.rateLimitDelayMs({ retryAfter: "garbage", attempt: 2 }), 4000, "bad Retry-After falls back to exponential");
}
// --- Ticket #6: pure attach-logic seam (no network, no SDK) ---
// Expected values come from the ticket + host docs (API.md section 1.4:
// attach id<=128, title<=200, url<=2000; badge 0-999, null clears),
// not from the code.
const attach = await import("./attach-logic.mjs").catch(() => null);
if (!attach) fail("plane/attach-logic.mjs missing");
else {
  const eq = (actual, expected, label) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(`${label}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
    else ok(label);
  };
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
}
if (process.exitCode) console.error("CHECK FAILED"); else console.log("CHECK PASSED");
