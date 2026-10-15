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
// The package .svg panel.icon needs a host that parses it; older hosts must
// meet the compatibility gate instead of rejecting the whole manifest.
if (oc?.engines?.openchamber !== ">=1.24.0") fail("openchamber.engines.openchamber must be >=1.24.0"); else ok("engines.openchamber is >=1.24.0");
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
// Plane rejects an empty/absent scope param as invalid_scope, so the manifest
// must request its read scopes explicitly.
if (!c.integration?.oauth?.scopes?.length) fail("oauth scopes must be requested (Plane rejects an empty scope)");
for (const s of ["profile:read", "projects.work_items:read", "projects:read", "projects.states:read", "projects.members:read"])
  if (!c.integration?.oauth?.scopes?.includes(s)) fail(`oauth scope missing: ${s}`); else ok(`scope ${s}`);
for (const cap of ["prompt", "sessions"])
  if (!c.capabilities?.includes(cap)) fail(`capability missing: ${cap}`); else ok(`capability ${cap}`);
for (const id of ["workspace-slug", "default-project"])
  if (!c.integration?.settings?.some((f) => f.id === id)) fail(`settings field missing: ${id}`); else ok(`setting ${id}`);
if (!c.commands?.some((cmd) => cmd.name === "plane")) fail('slash command "plane" missing'); else ok('command "plane"');
if (c.page !== true) fail('contributes.page must be true (full-screen page reuses panel.entry)'); else ok('contributes.page reuses panel.entry');

const html = new URL("./panel/index.html", dir);
if (!existsSync(html)) fail("panel/index.html missing"); else ok("panel/index.html exists");
// A package .svg panel.icon becomes an authenticated asset URL; a missing file
// would silently fall back to the generic app icon on the rail and integration card.
const icon = c.panel?.icon;
if (typeof icon === "string" && icon.toLowerCase().endsWith(".svg") && !existsSync(new URL(`./${icon}`, dir)))
  fail(`panel.icon svg missing: ${icon}`); else ok(`panel.icon resolves: ${icon}`);
const js = new URL("./panel/main.js", dir);
if (!existsSync(js)) fail("panel/main.js missing (run the bundler)"); else {
  const src = readFileSync(js, "utf8");
  if (/^\s*(import|export)\s/m.test(src)) fail("panel/main.js must be a classic script, not an ES module");
  else ok("panel/main.js is a classic script");
  if (!src.includes("Not connected")) fail("panel/main.js missing not-connected empty state"); else ok("not-connected empty state present");
  for (const needle of [
    "state_id__in", // work-item list carries the state filter (issue #10)
    "/states/", // states come from the project's own workflow (issue #10)
    "order_by", // states are asked for in workflow order
    "plane-section", // the grouped list renders per-state section headings
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
    "aria-modal", // the detail modal is a dialog (issue #12)
    "Could not load this work item", // the archived/failed notice
    "Loading work item", // the modal's loading label
    "plane-rich", // the description renders through the allow-list (issue #13)
  ]) if (!src.includes(needle)) fail(`panel/main.js missing detail wiring: ${needle}`); else ok(`detail wiring present: ${needle}`);
  for (const needle of [
    "openPopover", // the rail's detail pops out of the panel into a host frame (issue #16)
    "plane-detail-", // a fresh popover id per opening
    "popovers", // feature-detected, so an older host keeps the in-frame overlay
    "setHeight", // the popped-out card is as tall as its content
  ]) if (!src.includes(needle)) fail(`panel/main.js missing popover wiring: ${needle}`); else ok(`popover wiring present: ${needle}`);
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
  eq(typeof base.fields === "string" && base.fields.split(",").includes("state_id"), true, "query trims fields incl. state_id");
  eq(base.per_page, "25", "query pages at 25");
  eq("search" in base || "state_id__in" in base || "assignee_id" in base, false, "empty filters send no filter keys");
  const full = browse.workItemsQuery({ search: "api crash", stateId: "s1", assigneeId: "u1", offset: "25" });
  eq([full.search, full.state_id__in, full.assignee_id, full.offset], ["api crash", "s1", "u1", "25"], "query carries search/filter/offset");
  eq("state_group__in" in full, false, "the state-group filter is gone (issue #10)");
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
    { id: "u", identifier: "ACME-7", title: "Fix login", state: "In Progress", stateGroup: "started" }, "row shows identifier, title, state, state group");
  eq(browse.normalizeWorkItem({ id: "u", name: "Sparse", state_id: "s1" }).state, "s1", "sparse state falls back to state_id");
  eq(browse.normalizeWorkItem({ id: "u", name: "Sparse", state_id: "s1" }).stateGroup, null, "a sparse state has no group");
  // --- Issue #10: the project's states and the pill's tone ---
  // Expected values come from the Plane v2 states endpoint and the issue, not
  // from the code: `order_by=sequence` is the project's workflow order.
  eq(browse.statesPath("acme", "p1"), "/api/v2/workspaces/acme/projects/p1/states/", "states path");
  eq(browse.statesQuery().order_by, "sequence", "states are asked for in workflow order");
  eq(browse.normalizeState({ id: "s1", name: "In Progress", group: "started", sequence: 25000 }),
    { id: "s1", name: "In Progress", group: "started" }, "state normalises to id, name and group");
  eq(browse.normalizeState({ id: "s2" }), { id: "s2", name: "s2", group: null }, "a sparse state keeps its id as the name");
  for (const bad of [null, undefined, "nope", 42, {}, { name: "no id" }, { id: "" }]) eq(browse.normalizeState(bad), null, `state rejects ${JSON.stringify(bad)}`);
  eq(browse.normalizeStates({ data: [{ id: "a", name: "Todo", group: "unstarted" }, { name: "no id" }], next: null }).map((s) => s.name), ["Todo"], "states unwrap the envelope and drop sparse rows");
  eq(browse.normalizeStates([{ id: "a", name: "A" }, { id: "b", name: "B" }]).length, 2, "states accept a bare array");
  for (const bad of [null, undefined, "nope", 42, {}]) eq(browse.normalizeStates(bad), [], `states reject ${JSON.stringify(bad)}`);
  eq(browse.unwrapSingle({ data: [{ id: "a" }] }), { id: "a" }, "unwrap takes the first of a data array");
  eq(browse.unwrapSingle({ data: { id: "a" } }), { id: "a" }, "unwrap takes a data object");
  eq(browse.unwrapSingle({ id: "a" }), { id: "a" }, "unwrap passes a bare item");
  eq(browse.unwrapSingle({ data: [] }), null, "unwrap gives null for an empty array");
  eq(browse.stateTone("started"), "info", "started is info");
  eq(browse.stateTone("completed"), "success", "completed is success");
  eq(browse.stateTone("cancelled"), "error", "cancelled is error");
  eq(browse.stateTone("backlog"), "neutral", "backlog is neutral");
  eq(browse.stateTone("unstarted"), "neutral", "unstarted is neutral");
  eq(browse.stateTone(undefined), "neutral", "an unknown state group is neutral");
  eq("STATE_GROUPS" in browse, false, "the state-group constant is gone (issue #10)");
  // --- Issue #11: sections by state ---
  // Expected values come from the issue: the project's workflow order, rows
  // in the order the list loaded them, unreadable states last.
  const stateList = [
    { id: "s1", name: "Todo", group: "unstarted", sequence: 15000 },
    { id: "s2", name: "In Progress", group: "started", sequence: 25000 },
    { id: "s3", name: "Done", group: "completed", sequence: 35000 },
  ];
  const groupedRows = [
    { id: "a", state: "Done" },
    { id: "b", state: "In Progress" },
    { id: "c", state: "Done" },
    { id: "d", state: "Mystery" },
    { id: "e", state: "Todo" },
  ];
  const sections = browse.groupRowsByState(groupedRows, stateList);
  eq(sections.map((s) => s.state), ["Todo", "In Progress", "Done", "No state"], "sections follow the workflow order, unreadable states last");
  eq(sections[2].rows.map((r) => r.id), ["a", "c"], "rows keep their order inside a section");
  eq(browse.groupRowsByState([{ id: "x" }, { id: "y", state: "Mystery" }, { id: "z", state_id: "s9" }], stateList).map((s) => [s.state, s.rows.length]),
    [["No state", 3]], "every unreadable state shares one trailing section");
  eq(browse.groupRowsByState([], stateList), [], "no rows, no sections");
  eq(browse.sectionLabel({ state: "In Progress", rows: [{}, {}] }), "In Progress · 2", "the section label names the state and the loaded rows");
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
    { id: "u", identifier: "PROJ-142", title: "Fix login", state: "In Progress", stateGroup: "started" }, "resolve unwraps a bare work item");
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
// --- Issue #12: pure detail-logic seam (no network, no SDK) ---
// Expected values come from the issue and the Plane v2 by-identifier response
// shape, not from the code.
const detail = await import("./detail-logic.mjs").catch(() => null);
if (!detail) fail("plane/detail-logic.mjs missing");
else {
  eq(detail.detailQuery().expand, "state,assignees,labels", "the detail fetch expands state, assignees, labels");
  eq(detail.dateOnly("2026-01-14T09:22:41.478363Z"), "2026-01-14", "an ISO timestamp keeps its date");
  eq(detail.dateOnly("2026-01-12"), "2026-01-12", "a plain date passes through");
  for (const bad of [null, undefined, 42, "yesterday", ""]) eq(detail.dateOnly(bad), null, `dateOnly rejects ${JSON.stringify(bad)}`);
  eq(detail.priorityLabel("high"), "High", "a priority is titled");
  eq(detail.priorityLabel("none"), null, "the unset priority hides");
  eq(detail.priorityLabel("bogus"), null, "an unknown priority hides");
  eq(detail.relationNames([{ display_name: "Ada" }, { name: "api" }, {}, null]).join(","), "Ada,api", "relation names read users and labels");
  eq(detail.relationNames("nope"), [], "a non-array relation is empty");
  const shaped = detail.shapeWorkItemDetail({ data: [{ identifier: "PROJ-142", name: "Fix login", priority: "high", state: { name: "In Progress", group: "started" }, assignees: [{ display_name: "Ada" }], labels: [{ name: "api" }], start_date: "2026-01-12", target_date: null, created_at: "2026-01-14T09:22:41Z", updated_at: "2026-01-15T10:00:00Z", project_id: "p1", description_html: "<p>Loop</p>" }] });
  eq([shaped.identifier, shaped.title, shaped.state, shaped.stateGroup, shaped.priority], ["PROJ-142", "Fix login", "In Progress", "started", "High"], "the detail carries the core fields");
  eq([shaped.assignees.join(","), shaped.labels.join(","), shaped.projectId], ["Ada", "api", "p1"], "the detail carries relations and the project");
  eq([shaped.startDate, shaped.targetDate, shaped.createdAt], ["2026-01-12", null, "2026-01-14"], "the detail carries dates, missing ones null");
  eq(detail.shapeWorkItemDetail({ identifier: "PROJ-1", name: "Sparse" }).priority, null, "a sparse payload hides what it lacks");
  for (const bad of [null, undefined, "nope", 42, {}, { data: [] }, { name: "no id" }]) eq(detail.shapeWorkItemDetail(bad), null, `the detail rejects ${JSON.stringify(bad)}`);
  // --- Issue #13: the description allow-list ---
  // Hostile input is the point: these assertions are the trust boundary.
  eq(detail.parseDescriptionHtml("<p>Loop <b>now</b></p>"),
    [{ tag: "p", children: [{ text: "Loop " }, { tag: "b", children: [{ text: "now" }] }] }], "allow-listed tags build a tree");
  eq(detail.parseDescriptionHtml("<script>alert(1)</script>"), [{ text: "alert(1)" }], "a dropped tag keeps its text");
  eq(detail.parseDescriptionHtml('<style>p{color:red}</style><iframe src="https://x"></iframe>ok'),
    [{ text: "p{color:red}" }, { text: "ok" }], "style and frame tags drop, their text stays");
  eq(detail.parseDescriptionHtml('<img src=x onerror="alert(1)"><p onclick="alert(1)">ok</p>'),
    [{ tag: "p", children: [{ text: "ok" }] }], "attributes are dropped with their tags");
  eq(detail.parseDescriptionHtml('<a href="https://app.plane.so/x" target="_blank">Plane</a>'),
    [{ tag: "a", children: [{ text: "Plane" }], href: "https://app.plane.so/x" }], "an http link keeps its href and nothing else");
  eq(detail.parseDescriptionHtml('<a href="javascript:alert(1)">x</a>'),
    [{ tag: "a", children: [{ text: "x" }] }], "a non-http link renders as text");
  eq(detail.parseDescriptionHtml("<p>&lt;b&gt; &amp; more</p>"), [{ tag: "p", children: [{ text: "<b> & more" }] }], "entities decode into text");
  eq(detail.parseDescriptionHtml("<ul><li>a<li>b</ul>"),
    [{ tag: "ul", children: [{ tag: "li", children: [{ text: "a" }] }, { tag: "li", children: [{ text: "b" }] }] }], "an unclosed list item closes like a browser would");
  eq(detail.parseDescriptionHtml("<p>a</p></p>stray"), [{ tag: "p", children: [{ text: "a" }] }, { text: "stray" }], "a stray close is ignored");
  eq(detail.parseDescriptionHtml(undefined), [], "a missing description is an empty tree");
  eq(detail.isHttpUrl("https://x"), true, "http links pass");
  eq(detail.isHttpUrl("javascript:x"), false, "javascript: does not");
}
if (process.exitCode) console.error("CHECK FAILED"); else console.log("CHECK PASSED");
