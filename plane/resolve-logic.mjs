// Pure slash-command resolve helpers for issue #7: argument parsing and
// single-work-item unwrapping. No DOM, no SDK, no network — exercised
// directly by plane/check.mjs. The panel fetches via the v2 direct GET
// …/work-items/{identifier}/ path (reuse workItemByIdentifierPath from
// browse-logic.mjs) and shapes the chip via buildAttachItem from
// attach-logic.mjs; unknown/bad identifiers resolve to null (nothing found,
// no chip, no error toast).
import { isIdentifierQuery, normalizeWorkItem } from "./browse-logic.mjs";

// "/plane PROJ-142" -> "PROJ-142". Only the first whitespace-separated
// token counts; anything else (blank, prose, a bare number, a non-string)
// is null. The typed case is kept: the chip carries the server-returned
// work item identifier, so no canonicalization is needed here.
export function parseCommandArgs(args) {
  if (typeof args !== "string") return null;
  const first = args.trim().split(/\s+/)[0];
  if (!first || !isIdentifierQuery(first)) return null;
  return first;
}

// Unwrap the parsed body of the by-identifier GET (bare item, {data:[…]},
// or {data:{…}} — v2 list endpoints envelope, the single fetch may too)
// into a normalized row, or null when there is nothing to attach.
export function resolveWorkItem(parsed) {
  const single = Array.isArray(parsed?.data)
    ? (parsed.data[0] ?? null)
    : parsed?.data && typeof parsed.data === "object"
      ? parsed.data
      : parsed;
  const row = normalizeWorkItem(single);
  if (!row || !row.identifier) return null;
  return row;
}
