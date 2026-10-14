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

## Known needs-tenant risks (from #3)

- Authorize/token URLs use the generic OAuth paths
  (`/auth/o/authorize/`, `/auth/o/token/`). If the host flow expects the
  Plane-app consent path (`/auth/o/authorize-app/` + `app_installation_id`
  exchange), update `plane/package.json` and re-run the bundler + check.
- `read` (global) is requested alongside the fine-grained read scopes so
  `/api/v2/users/me/` accepts the OAuth token (decided on #2).
