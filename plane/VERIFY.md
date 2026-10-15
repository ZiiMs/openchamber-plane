# Manual verification — issue #4 scaffold (no tenant credentials in dev)

No automated seam exists beyond `node plane/check.mjs` (bundler + SDK
manifest parse). A human with a Plane Cloud tenant walks this list once.

## Setup

- [ ] `node plane/check.mjs` prints CHECK PASSED.
- [ ] Settings → Extensions → Add folder `.../plane` succeeds; rail icon appears.
- [ ] The Extension pages menu offers Plane full-screen (the page reuses
      `panel.entry`; `contributes.page` is `true`).
- [ ] Install approval dialog lists capabilities `prompt`, `sessions`, `network`
      (network follows from the integration) and no others.
- [ ] The host is OpenChamber 2.x, which advertises guest popovers
      (`ready.features.popovers`). On an older host the rail keeps the in-frame
      detail modal (issue #12) — nothing else changes.

## Connect

- [ ] Settings → Integrations → Plane card shows a Connect control.
- [ ] OAuth connect completes; the panel proceeds straight to the filter
      bar and work-item list (no account line).
- [ ] The account lookup is `GET /api/v1/users/me/` (host-attached Bearer);
      v2 `/api/v2/users/me/` answers 403 for this app, so v1 is the working
      path for the assigned-to-me user id.

## Disconnect / reconnect

- [ ] Disconnect: panel shows the "Not connected" empty state.
- [ ] Reconnect: the filter bar and list return without a panel reload.

## Settings persistence

- [ ] Set Workspace slug + Default project, close and reopen Settings: values persist.

## Workspace auto-discovery (issue #8)

Pure seam without a tenant: `node plane/check.mjs` covers the discovery
path (`WORKSPACES_DISCOVERY_PATH`) and slug parsing
(`parseDiscoveredWorkspaces`: plain array of `{id, name, slug}`, invalid
slugs dropped, anything else `[]`). A human with a Plane Cloud tenant
walks this list once:

- [ ] With no Workspace slug set, the panel tries `GET
      /api/v1/users/me/workspaces/` and names the discovered slugs in the
      "No workspace slug" empty state (today this GET 404s — upstream PR
      makeplane/plane#9503 is unmerged — so the empty state stays manual).
- [ ] Any discovery failure (404, unparsable body) leaves the manual
      Workspace-slug settings path untouched.

## Browse (issue #5)

Pure seams without a tenant: `node plane/check.mjs` covers request
paths/query shapes (`projectsPath`, `workItemsPath`,
`workItemByIdentifierPath`, `search`/`state_group__in`/`assignee_id`/
`expand=state,assignees`/`fields`), both v2 envelope styles
(`pagination.style` offset vs cursor) plus `total_count` for the rail
badge, row normalization
(identifier/title/state), canonical browse URLs, and backoff delays.
A human with a Plane Cloud tenant walks this list once:

- [ ] Set Workspace slug + Default project; the unified filter bar shows
      the default project pre-selected in its project menu.
- [ ] Work-item rows show work item identifier, title, and state.
- [ ] Search by text narrows the list; search by identifier (e.g. PROJ-142)
      surfaces the exact work item even when `?search=` alone would miss it.
- [ ] Assigned to me narrows the list correctly. (The workflow filter is the
      State control now — see "State pill and State filter" below.)
- [ ] Scrolling near the end of the list appends the next page automatically
      (a short list pages through on its own); a failed page keeps Retry.
- [ ] Selecting a row highlights it and enables the row actions below;
      Open in Plane opens `{web-base}/{slug}/browse/{identifier}/` in
      the host browser.
- [ ] Blank slug shows the "No workspace slug" state; a bogus slug shows
      the "Unknown workspace slug" error — never a spinner hang.
- [ ] Heavy paging degrades to a rate-limit notice plus Retry, then recovers.

## Attach (issue #6)

Pure seams without a tenant: `node plane/check.mjs` covers chip shaping
(`providerId` plane, id = work item identifier, title, canonical browse URL;
clamped to host limits id<=128, title<=200, url<=2000), new-session text
(identifier, title, link, state), open-work-item count (skips the
completed/cancelled state groups; unknown groups still count as open),
and badge values (the v2 envelope `total_count` when the list response
carries it, else the loaded-row open count; null when disconnected
or zero, clamped to 999). `onResolve` still returns null — slash-command
identifier resolution is issue #7. A human with a Plane Cloud tenant walks
this list once:

- [ ] Selecting a work-item row enables Attach chip, Start session,
      Link to open session, and Open in Plane (disabled with no selection).
- [ ] Attach chip puts a chip on the chat box that deep-links to the work
      item's browse URL; from the attach dialog the dialog closes after.
- [ ] Start session carries title, link, and state into the new session.
- [ ] Link to open session links the selected work item; with no open
      session the panel says "No open session — open or start a session
      first, then link." instead of a raw error.
- [ ] The rail icon shows the open work item count while browsing; it
      clears on disconnect, on an empty list, and when no slug is set.

## Command attach + remembered mapping (issue #7)

Pure seams without a tenant: `node plane/check.mjs` covers command-arg
parsing (`parseCommandArgs`: trims, reads the first token, rejects blanks /
prose / bare numbers / non-strings, keeps the typed case), single-item
unwrapping (`resolveWorkItem`: bare item vs `{data:[…]}` vs `{data:{…}}`
envelopes, null when nothing is attachable), the remembered-mapping merge
(`mergeMapping`: settings win, storage fills blanks per field), and the
panel bundle wiring (`onResolve` reads `args` and fetches the v2 direct GET
`…/work-items/{identifier}/` path; `plane.workspace-slug` /
`plane.default-project` cached via `host.storage`). A human with a Plane
Cloud tenant walks this list once:

- [ ] `/plane PROJ-142` (a scratch-workspace identifier) attaches the work
      item as a chat-box chip without opening the panel; the chip
      deep-links to `{web-base}/{slug}/browse/{identifier}/`.
- [ ] `/plane NOPE-999` and `/plane hello` resolve to nothing-found: no
      chip and no error toast (the host shows its short notice).
- [ ] `/plane PROJ-142` with no workspace slug set resolves to
      nothing-found, not an error.
- [ ] Set Workspace slug + Default project, fully restart the host, reopen:
      browse still targets the same workspace/project without re-entering
      anything (the storage cache filled the blanks).
- [ ] Change Workspace slug and Default project: browse re-targets (project
      list plus rows come from the new workspace) and `/plane <id>`
      resolves against the new workspace.
- [ ] Full walk-through on a scratch workspace, in order: connect → browse
      (search plus the State filter surface the work item) →
      `/plane <id>` command-attach → chip on the chat box → session with
      the chip attached.

## State pill and State filter (issue #10)

Pure seams without a tenant: `node plane/check.mjs` covers the states path and
query (`order_by=sequence`), state normalization (envelope or bare array,
sparse rows dropped), the work-item query's `state_id__in` and the absence of
`state_group__in`, the pill's tone map per state group, and the panel bundle's
state wiring. A human with a Plane Cloud tenant walks this list once:

- [ ] Rows carry a pill with their state (e.g. "In Progress"), toned by the
      state's group (started → info, completed → success, cancelled → error,
      backlog/unstarted → neutral); the muted second line is gone.
- [ ] The State menu in the filter bar lists the project's states in the project's workflow
      order with "All states" first; the state-group control
      is gone.
- [ ] Picking "In Progress" (or "In Review") narrows the list to that state —
      a filter the v1 state-group control could not express.
- [ ] Switching project re-loads the states and clears a state the new project
      does not have.
- [ ] With `GET …/states/` failing, the list still loads with "All states" and no
      state options.

## Grouped list (issue #11)

Pure seams without a tenant: `node plane/check.mjs` covers section bucketing,
section order (the project's workflow order, unreadable states in one trailing
section), row order inside a section, and the section label. A human with a
Plane Cloud tenant walks this list once:

- [ ] The list renders as sections, one per state, in the project's workflow
      order, with anything whose state cannot be read sharing a final
      "No state" section.
- [ ] Each header reads "<state> · <count>", and the count matches the rows
      shown under it.
- [ ] Rows stay newest-first inside a section.
- [ ] Load more appends rows into their own sections and the counts grow.
- [ ] Arrow keys move within a section, Tab moves between sections, and the
      selected row stays highlighted across sections.
- [ ] Selecting one state in the State control shows a flat list with no
      headers.

## Work item detail modal (issue #12)

Pure seams without a tenant: `node plane/check.mjs` covers the detail fetch's
expand set, date and priority shaping, relation names, and the display shape
with missing fields hidden. A human with a Plane Cloud tenant walks this list
once:

- [ ] Clicking a row selects it and opens the modal; the row behind it stays
      highlighted.
- [ ] The modal shows title, identifier, the state pill, priority, assignees,
      start and target dates, created and updated dates, project, and labels —
      missing fields are absent, never "undefined".
- [ ] Esc, a press on the backdrop, and Close all dismiss it; focus returns to
      the list.
- [ ] The footer carries Open in Plane, Attach chip, Start session, and Link to
      open session; the panel's own footer action bar is gone.
- [ ] On the rail the detail pops out of the panel now — see "Popped-out detail"
      below; on the full page it centres at a readable width.
- [ ] A work item archived after the list loaded shows "Could not load this
      work item" with Open in Plane still offered.
- [ ] Retry still works from the panel footer.

## Popped-out detail (issue #16)

The rail is a few hundred pixels wide, so the same card is drawn by a host
popover instead: `host.openPopover` anchors it to the row and the host mounts
`panel.entry` again with `ready.surface === "popover"` and the work item in
`ready.popover.data`. Pure seam without a tenant: `node plane/check.mjs` covers
the panel bundle wiring (`openPopover`, the `plane-detail-` id prefix, the
`popovers` feature check that keeps an older host on the in-frame modal, and
`setHeight`). A human with a Plane Cloud tenant walks this list once:

- [ ] Clicking a work item on the rail opens its detail outside the panel,
      anchored to the row and floating over the whole window (at most 640 wide
      and 480 tall; the host shrinks it to fit a small window and flips or
      shifts it to stay on screen).
- [ ] The card carries the same fields, formatted description and footer as the
      in-frame modal (issue #12/#13); Close, Escape and a click outside dismiss
      it, and the row behind stays highlighted.
- [ ] Attach chip / Start session / Link to open session work from the card and
      the card goes away after; Open in Plane opens the browser.
- [ ] A short work item's card is only as tall as its content; a long
      description scrolls inside the 480px cap.
- [ ] Scrolling the list, switching project or opening a host dialog dismisses
      the card; picking another row replaces it.
- [ ] On a host without popover support (`ready.features.popovers` absent) the
      rail keeps the in-frame overlay from issue #12, and the full-screen page
      keeps it on every host.

## Formatted description (issue #13)

Pure seams without a tenant: `node plane/check.mjs` covers the allow-list tree
— unknown tags dropped with their text kept, attributes dropped, http links
kept and other schemes dropped, entities decoded, unclosed list items closed
like a browser would. A human with a Plane Cloud tenant walks this list once:

- [ ] A description with paragraphs, a list, code, and a link renders as
      formatting, not as markup.
- [ ] A link in the description opens in the browser and does not navigate the
      panel away.
- [ ] Markup the allow-list rejects (script, style, iframe, event-handler
      attributes) shows as text, with nothing executed.

## Known needs-tenant risks (from issue #3, extended on issue #5)

- Canonical web base for browse URLs is assumed
  `https://app.plane.so`; fix `PLANE_WEB_BASE` in `plane/browse-logic.mjs`
  if tenant links live elsewhere, then rebuild + re-check.
- `?fields=` names and the `assignee_id=<users/me id>` value are confirmed
  against a tenant. `state` in `fields` is rejected with 400 ("'state' is an
  expandable relation"), so the list asks for `state_id` and takes the state
  name/group from `expand=state`. `search` and `offset` paging are confirmed
  too; `state_group__in` was, but the panel sends `state_id__in` now.
- The per-project states path, its `order_by=sequence` order, the
  `state_id__in` work-item filter, and the detail fetch's
  `expand=state,assignees,labels` are documented for v2 and marked
  `needs-tenant` in `plane/browse-logic.mjs` and `plane/detail-logic.mjs`;
  the state and detail sections above are the walk that confirms them.
- Cursor continuation (`paginate=cursor` + `cursor=`) is a guess; offset
  paging is the default path and is covered by the shape tests.
- `Default project` matches by project id first, then name; confirm which
  the settings field actually holds.

## Known needs-tenant risks (from issue #3)

- Authorize URL uses the Plane-app consent path
  (`/auth/o/authorize-app/`); token URL uses `/auth/o/token/` with the
  user-token (`authorization_code`) exchange.
- The authorize request must carry an explicit `scope` list; Plane answers
  `invalid_scope` for an empty/absent one. The five read scopes are what the
  panel actually uses (`profile:read` for `/api/v2/users/me/`).
