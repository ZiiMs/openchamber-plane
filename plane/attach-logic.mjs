// Pure Plane attach helpers for ticket #6: chip shaping, new-session text,
// open-work-item count, rail badge value. No DOM, no SDK, no network —
// exercised directly by plane/check.mjs.
import { browseUrl } from "./browse-logic.mjs";

// Host limits (SDK API.md section 1.4): the client clamps before send,
// so shaping here matches what the host enforces.
export const ATTACH_PROVIDER_ID = "plane";
export const ATTACH_ID_MAX = 128;
export const ATTACH_TITLE_MAX = 200;
export const ATTACH_URL_MAX = 2000;
export const ATTACH_TEXT_MAX = 16000;
export const BADGE_MAX = 999;

// State groups that mean the work is over; everything else (or an unknown
// sparse row) counts as open. needs-tenant: confirm group names.
export const CLOSED_STATE_GROUPS = ["completed", "cancelled"];

const clamp = (value, max) =>
  typeof value === "string" && value.length > max ? value.slice(0, max) : value;

// Chip for host.attach / host.sessionLink: id is the work item identifier,
// url is the canonical browse URL.
export function buildAttachItem({ slug, identifier, title }) {
  return {
    providerId: ATTACH_PROVIDER_ID,
    id: clamp(identifier, ATTACH_ID_MAX),
    title: clamp(title, ATTACH_TITLE_MAX),
    url: clamp(browseUrl(slug, identifier), ATTACH_URL_MAX),
  };
}

// First-message text for host.startSession: title, link, and context travel together.
export function buildSessionText({ identifier, title, url, state }) {
  const lines = [`${identifier}: ${title}`, url];
  if (typeof state === "string" && state && state !== "—") lines.push(`State: ${state}`);
  return clamp(lines.join("\n"), ATTACH_TEXT_MAX);
}

export function isOpenWorkItem(raw) {
  const group = raw?.state?.group;
  return typeof group !== "string" || !CLOSED_STATE_GROUPS.includes(group);
}

export function countOpenWorkItems(items) {
  return (Array.isArray(items) ? items : []).filter(isOpenWorkItem).length;
}

// Rail badge: null clears it (disconnected or nothing open).
export function badgeForOpenCount(connected, openCount) {
  if (!connected) return null;
  if (typeof openCount !== "number" || openCount <= 0) return null;
  return Math.min(Math.floor(openCount), BADGE_MAX);
}
