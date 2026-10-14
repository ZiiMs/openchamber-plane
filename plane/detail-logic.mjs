// Pure helpers for the work-item detail modal (issue #12): the by-identifier
// fetch shape and the display fields it renders. No DOM, no SDK, no network —
// exercised directly by plane/check.mjs. The description HTML is handed on
// untouched; issue #13 sanitizes it into the tree the modal renders.

// The relations the modal renders (Plane v2 `expand`).
export const DETAIL_EXPAND = "state,assignees,labels";

export function detailQuery() {
  return { expand: DETAIL_EXPAND };
}

// ISO timestamp or plain date -> "YYYY-MM-DD"; anything else null (hidden).
export function dateOnly(value) {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match ? match[1] : null;
}

// "high" -> "High". "none" is the unset default and stays hidden, as does
// anything unrecognized.
export function priorityLabel(priority) {
  const known = ["urgent", "high", "medium", "low"];
  return typeof priority === "string" && known.includes(priority)
    ? priority[0].toUpperCase() + priority.slice(1)
    : null;
}

// Names from an expanded relation array: users carry display_name, labels
// carry name. Entries without either drop out.
export function relationNames(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry?.name === "string" && entry.name) || (typeof entry?.display_name === "string" && entry.display_name) || "")
    .filter(Boolean);
}

// The modal's display shape, tolerant of a sparse payload: bare item,
// {data: {…}} or {data: [ … ]} all unwrap, and every missing field hides
// rather than rendering "undefined".
export function shapeWorkItemDetail(payload) {
  const raw = Array.isArray(payload?.data)
    ? (payload.data[0] ?? null)
    : payload?.data && typeof payload.data === "object"
      ? payload.data
      : payload;
  if (!raw || typeof raw !== "object") return null;
  const identifier = typeof raw.identifier === "string" && raw.identifier ? raw.identifier : null;
  if (!identifier) return null;
  return {
    identifier,
    title: typeof raw.name === "string" && raw.name ? raw.name : "(untitled)",
    state: (typeof raw.state?.name === "string" && raw.state.name) || "—",
    stateGroup: typeof raw.state?.group === "string" ? raw.state.group : null,
    priority: priorityLabel(raw.priority),
    assignees: relationNames(raw.assignees),
    labels: relationNames(raw.labels),
    startDate: dateOnly(raw.start_date),
    targetDate: dateOnly(raw.target_date),
    createdAt: dateOnly(raw.created_at),
    updatedAt: dateOnly(raw.updated_at),
    projectId: typeof raw.project_id === "string" ? raw.project_id : null,
    description: typeof raw.description_html === "string" ? raw.description_html : "",
  };
}

// Plain text from Plane's description HTML. Interims only: issue #13 replaces
// this with the sanitizing allow-list. Entities decode after tags are dropped,
// so escaped markup stays text.
export function plainTextFromHtml(html) {
  if (typeof html !== "string") return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|blockquote|pre)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
