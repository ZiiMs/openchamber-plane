// Pure remembered-mapping helpers for issue #7: the workspace slug plus
// default project live in the integration settings fields and are cached in
// per-extension host.storage. Read-through: settings win, storage fills
// blanks, writes update both — so returning users are not asked twice.
// No DOM, no SDK, no network — exercised directly by plane/check.mjs.
export const MAPPING_STORAGE_KEYS = {
  slug: "plane.workspace-slug",
  defaultProject: "plane.default-project",
};

const clean = (value) => (typeof value === "string" ? value.trim() : "");

// Each side is {slug, defaultProject}; either side may be missing or hold
// non-strings (raw storage values). Merge is per field: a blank settings
// value falls back to the stored one.
export function mergeMapping(settings, stored) {
  const fromSettings = {
    slug: clean(settings?.slug),
    defaultProject: clean(settings?.defaultProject),
  };
  const fromStored = {
    slug: clean(stored?.slug),
    defaultProject: clean(stored?.defaultProject),
  };
  return {
    slug: fromSettings.slug || fromStored.slug,
    defaultProject: fromSettings.defaultProject || fromStored.defaultProject,
  };
}
