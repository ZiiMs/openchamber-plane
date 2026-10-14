// Pure helpers for the work-item detail modal (issue #12): the by-identifier
// fetch shape and the display fields it renders. No DOM, no SDK, no network —
// exercised directly by plane/check.mjs. The description HTML is parsed here
// into an allow-listed tree (issue #13); the panel only ever builds elements
// from that tree, so nothing in a Plane description can become markup.

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

// --- Description allow-list (issue #13) ---
// Plane descriptions are HTML authored by any member of the workspace, so the
// panel never inserts them as markup: this parses them into a tree of text and
// allow-listed elements, and the panel builds elements from that tree.
const ALLOWED_TAGS = new Set(["p", "br", "b", "i", "strong", "em", "code", "pre", "ul", "ol", "li", "h1", "h2", "h3", "a"]);
const VOID_TAGS = new Set(["br"]);

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, body) => {
    if (body[0] === "#") {
      const code = body[1] === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[body.toLowerCase()] ?? match;
  });
}

// Only http(s) survives: javascript:, data: and friends become plain text.
export function isHttpUrl(value) {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim());
}

// -> [{text} | {tag, href?, children}], in document order. Unknown tags are
// dropped while their text survives, every attribute except an http(s) href on
// an `a` is dropped, and a new <li> closes the open one, as a browser would.
export function parseDescriptionHtml(html) {
  if (typeof html !== "string" || !html) return [];
  const root = { tag: "#root", children: [] };
  const stack = [root];
  const top = () => stack[stack.length - 1];
  for (const token of html.split(/(<[^>]*>)/)) {
    if (!token || token.startsWith("<!--")) continue;
    if (token[0] !== "<") {
      top().children.push({ text: decodeEntities(token) });
      continue;
    }
    const name = (/^<\s*\/?\s*([a-zA-Z][a-zA-Z0-9]*)/.exec(token)?.[1] ?? "").toLowerCase();
    if (!name) {
      top().children.push({ text: decodeEntities(token) });
      continue;
    }
    if (/^<\s*\//.test(token)) {
      for (let i = stack.length - 1; i > 0; i -= 1) {
        if (stack[i].tag === name) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    if (!ALLOWED_TAGS.has(name)) continue;
    if (name === "li" && top().tag === "li") stack.pop();
    const node = { tag: name, children: [] };
    if (name === "a") {
      const match = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(token);
      const href = (match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();
      if (isHttpUrl(href)) node.href = href;
    }
    top().children.push(node);
    if (!VOID_TAGS.has(name) && !/\/>$/.test(token)) stack.push(node);
  }
  return root.children;
}
