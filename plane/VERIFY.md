# Manual verification — ticket #4 scaffold (no tenant credentials in dev)

No automated seam exists beyond `node plane/check.mjs` (bundler + SDK
manifest parse). A human with a Plane Cloud tenant walks this list once.

## Setup

- [ ] `node plane/check.mjs` prints CHECK PASSED.
- [ ] Settings → Extensions → Add folder `.../plane` succeeds; rail icon appears.
- [ ] Install approval dialog lists capabilities `prompt`, `sessions`, `network`
      (network follows from the integration) and no others.

## Connect

- [ ] Settings → Integrations → Plane card shows a Connect control.
- [ ] OAuth connect completes; panel shows "Connected as <display_name>".
- [ ] The account lookup is `GET /api/v2/users/me/` (host-attached Bearer).

## Disconnect / reconnect

- [ ] Disconnect: panel shows the "Not connected" empty state, no stale account.
- [ ] Reconnect: account line returns without a panel reload.

## Settings persistence

- [ ] Set Workspace slug + Default project, close and reopen Settings: values persist.

## Browse (ticket #5)

Pure seams without a tenant: `node plane/check.mjs` covers request
paths/query shapes (`projectsPath`, `workItemsPath`,
`workItemByIdentifierPath`, `search`/`state_group__in`/`assignee_id`/
`expand=state,assignees`/`fields`), both v2 envelope styles
(`pagination.style` offset vs cursor), row normalization
(identifier/title/state), canonical browse URLs, and backoff delays.
A human with a Plane Cloud tenant walks this list once:

- [ ] Set Workspace slug + Default project; panel lists projects with the
      default pre-selected in the Project control.
- [ ] Work-item rows show work item identifier, title, and state.
- [ ] Search by text narrows the list; search by identifier (e.g. PROJ-142)
      surfaces the exact work item even when `?search=` alone would miss it.
- [ ] State-group control (backlog, unstarted, started, completed,
      cancelled) and Assigned to me narrow the list correctly.
- [ ] Scrolling past 25 rows offers Load more and appends the next page.
- [ ] Selecting a row opens `{web-base}/{slug}/browse/{identifier}/` in
      the host browser.
- [ ] Blank slug shows the "No workspace slug" state; a bogus slug shows
      the "Unknown workspace slug" error — never a spinner hang.
- [ ] Heavy paging degrades to a rate-limit notice plus Retry, then recovers.

## Known needs-tenant risks (from #3, extended on #5)

- Canonical web base for browse URLs is assumed
  `https://app.plane.so`; fix `PLANE_WEB_BASE` in `plane/browse-logic.mjs`
  if tenant links live elsewhere, then rebuild + re-check.
- Sparse `?fields=` names (`id,name,identifier,sequence_id,state`) and the
  `assignee_id=<users/me id>` value for assigned-to-me are docs-plausible
  guesses; confirm against a tenant and adjust `browse-logic.mjs`.
- Cursor continuation (`paginate=cursor` + `cursor=`) is a guess; offset
  paging is the default path and is covered by the shape tests.
- `Default project` matches by project id first, then name; confirm which
  the settings field actually holds.

## Known needs-tenant risks (from #3)

- Authorize/token URLs use the generic OAuth paths
  (`/auth/o/authorize/`, `/auth/o/token/`). If the host flow expects the
  Plane-app consent path (`/auth/o/authorize-app/` + `app_installation_id`
  exchange), update `plane/package.json` and re-run the bundler + check.
- `read` (global) is requested alongside the fine-grained read scopes so
  `/api/v2/users/me/` accepts the OAuth token (decided on #2).
