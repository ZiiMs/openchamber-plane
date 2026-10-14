// Pure Plane browse helpers for issue #5: request paths, query shapes,
// v2 envelope branching, row normalization, browse URLs, rate-limit backoff.
// No DOM, no SDK, no network — exercised directly by plane/check.mjs.
// Field/value guesses that still need a tenant are marked needs-tenant.

// needs-tenant: confirm the canonical web base for browse URLs.
export const PLANE_WEB_BASE = "https://app.plane.so";

export const WORK_ITEMS_EXPAND = "state,assignees";
// Verified against the tenant: `state` is expandable, not a field, so the
// list 400s if it appears in `fields`; ask for `state_id` and expand=state.
export const WORK_ITEMS_FIELDS = "id,name,identifier,sequence_id,state_id";
export const WORK_ITEMS_PER_PAGE = 25;
export const STATE_GROUPS = ["backlog", "unstarted", "started", "completed", "cancelled"];

export function projectsPath(slug) {
  return `/api/v2/workspaces/${slug}/projects/`;
}

export function workItemsPath(slug, projectId) {
  return `/api/v2/workspaces/${slug}/projects/${projectId}/work-items/`;
}

export function workItemByIdentifierPath(slug, identifier) {
  return `/api/v2/workspaces/${slug}/work-items/${identifier}/`;
}

// Opportunistic workspace auto-discovery for issue #8: GET this path on
// connect/settings-load and offer the slugs when it answers. It 404s until
// upstream PR makeplane/plane#9503 merges (issue #3 spike notes §5), so any
// failure silently keeps the manual workspace-slug settings path. On success
// the PR returns a plain array of {id, name, slug}; anything else is [].
export const WORKSPACES_DISCOVERY_PATH = "/api/v1/users/me/workspaces/";

export function parseDiscoveredWorkspaces(payload) {
  if (!Array.isArray(payload)) return [];
  return payload.map((entry) => (typeof entry?.slug === "string" ? entry.slug : "")).filter((slug) => isValidSlug(slug));
}

export function isValidSlug(slug) {
  return typeof slug === "string" && /^[a-zA-Z0-9_-]+$/.test(slug);
}

// PREFIX-123, e.g. PROJ-142. Such queries also get a direct by-identifier
// fetch because v2 ?search= matches names only (issue #3 spike notes).
export function isIdentifierQuery(value) {
  return typeof value === "string" && /^[A-Za-z][A-Za-z0-9]*-\d+$/.test(value.trim());
}

// Flat string map: host.request takes query?: Record<string, string>.
export function workItemsQuery({ search, stateGroup, assigneeId, offset, perPage } = {}) {
  const query = { expand: WORK_ITEMS_EXPAND, fields: WORK_ITEMS_FIELDS, per_page: String(perPage ?? WORK_ITEMS_PER_PAGE) };
  if (search) query.search = search;
  if (stateGroup) query.state_group__in = stateGroup;
  if (assigneeId) query.assignee_id = assigneeId;
  if (offset !== undefined && offset !== null) query.offset = String(offset);
  return query;
}

// Branch on pagination.style: offset {data,next,total_count} vs cursor
// {data,next_cursor,has_more} (issue #3 spike notes). page null = no more pages.
// totalCount carries the v2 envelope total_count (all matching rows,
// including pages not yet loaded) for the rail badge; null when the
// response does not carry one, and callers fall back to loaded-row counts.
export function parseWorkItemsEnvelope(payload) {
  const items = Array.isArray(payload?.data) ? payload.data : [];
  const totalCount =
    typeof payload?.total_count === "number" && Number.isFinite(payload.total_count) ? payload.total_count : null;
  const style = payload?.pagination?.style;
  if (style === "cursor") {
    const next = typeof payload.next_cursor === "string" && payload.has_more ? payload.next_cursor : null;
    return { items, page: next === null ? null : { kind: "cursor", next }, totalCount };
  }
  const next = typeof payload?.next === "number" ? payload.next : null;
  return { items, page: next === null ? null : { kind: "offset", next }, totalCount };
}

// Defensive: expanded state object, sparse state_id, or bust.
export function normalizeWorkItem(raw) {
  if (!raw || typeof raw !== "object") return null;
  const identifier =
    (typeof raw.identifier === "string" && raw.identifier) ||
    (typeof raw.sequence_id === "number" ? String(raw.sequence_id) : null) ||
    (typeof raw.id === "string" ? raw.id : "");
  const title = (typeof raw.name === "string" && raw.name) || (typeof raw.title === "string" && raw.title) || "(untitled)";
  const state =
    (typeof raw.state?.name === "string" && raw.state.name) ||
    (typeof raw.state?.group === "string" && raw.state.group) ||
    (typeof raw.state_id === "string" && raw.state_id) ||
    "—";
  return { id: typeof raw.id === "string" ? raw.id : identifier, identifier, title, state };
}

export function browseUrl(slug, identifier) {
  return `${PLANE_WEB_BASE}/${slug}/browse/${identifier}/`;
}

// Honor Retry-After seconds when sane, else exponential backoff (1s, 2s, 4s…).
// The host request channel exposes status only, so callers pass the header
// value through when they have it and undefined otherwise.
export function rateLimitDelayMs({ retryAfter, attempt = 0 } = {}) {
  const fallback = Math.min(1000 * 2 ** Math.max(0, attempt), 30000);
  const seconds = Number(retryAfter);
  if (retryAfter === undefined || retryAfter === null || retryAfter === "" || !Number.isFinite(seconds) || seconds < 0) return fallback;
  return Math.min(Math.ceil(seconds * 1000), 30000);
}
