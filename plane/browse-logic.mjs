// Pure Plane browse helpers for issue #5: request paths, query shapes,
// v2 envelope branching, row normalization, browse URLs, rate-limit backoff.
// Issue #10 adds the per-project states the panel filters and names rows by.
// No DOM, no SDK, no network — exercised directly by plane/check.mjs.
// Field/value guesses that still need a tenant are marked needs-tenant.

// needs-tenant: confirm the canonical web base for browse URLs.
export const PLANE_WEB_BASE = "https://app.plane.so";

export const WORK_ITEMS_EXPAND = "state,assignees";
// Verified against the tenant: `state` is expandable, not a field, so the
// list 400s if it appears in `fields`; ask for `state_id` and expand=state.
export const WORK_ITEMS_FIELDS = "id,name,identifier,sequence_id,state_id";
export const WORK_ITEMS_PER_PAGE = 25;

// Pill tone per state group: the kit badge carries six tones, not Plane's
// per-state colours. `triage` is mapped for completeness; the default
// work-item list never returns triage items.
const STATE_TONES = {
  backlog: "neutral",
  unstarted: "neutral",
  started: "info",
  completed: "success",
  cancelled: "error",
  triage: "warning",
};

export function stateTone(group) {
  return STATE_TONES[group] ?? "neutral";
}

export function projectsPath(slug) {
  return `/api/v2/workspaces/${slug}/projects/`;
}

// States are defined per project; `order_by=sequence` is the project's own
// workflow order, which the filter and the section order both follow.
export function statesPath(slug, projectId) {
  return `/api/v2/workspaces/${slug}/projects/${projectId}/states/`;
}

export function statesQuery() {
  return { order_by: "sequence", per_page: "50" };
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
// Filtering is by state (`state_id__in`), not by state group: the states a
// project actually uses are what the panel offers (issue #10).
export function workItemsQuery({ search, stateId, assigneeId, offset, perPage } = {}) {
  const query = { expand: WORK_ITEMS_EXPAND, fields: WORK_ITEMS_FIELDS, per_page: String(perPage ?? WORK_ITEMS_PER_PAGE) };
  if (search) query.search = search;
  if (stateId) query.state_id__in = stateId;
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

// A project's states: {id, name, group, sequence}. Rows without an id drop.
export function normalizeState(raw) {
  if (!raw || typeof raw !== "object" || typeof raw.id !== "string" || !raw.id) return null;
  return {
    id: raw.id,
    name: typeof raw.name === "string" && raw.name ? raw.name : raw.id,
    group: typeof raw.group === "string" ? raw.group : null,
    sequence: typeof raw.sequence === "number" ? raw.sequence : null,
  };
}

// v2 envelope ({data, …}) or a bare array, keeping the server's order
// (order_by=sequence is the project's workflow order).
export function normalizeStates(payload) {
  const items = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
  return items.map(normalizeState).filter((state) => state !== null);
}

// Sections for the grouped list (issue #11): the project's workflow order
// first, work items whose state is not in that list last.
export function groupRowsByState(rows, states) {
  const rank = new Map(states.map((state, index) => [state.name, index]));
  const sections = new Map();
  for (const row of rows) {
    const name = row.state || "—";
    const section = sections.get(name);
    if (section) section.rows.push(row);
    else sections.set(name, { state: name, rows: [row] });
  }
  return [...sections.values()].sort(
    (a, b) => (rank.get(a.state) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.state) ?? Number.MAX_SAFE_INTEGER)
  );
}

export function sectionLabel(section) {
  return `${section.state} · ${section.rows.length}`;
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
  const stateGroup = typeof raw.state?.group === "string" ? raw.state.group : null;
  return { id: typeof raw.id === "string" ? raw.id : identifier, identifier, title, state, stateGroup };
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
