import { connectHost, HostRequestError } from "@openchamber/sdk";
import {
  applyHostReady,
  mountBanner,
  mountButton,
  mountCheckbox,
  mountEmpty,
  mountList,
  mountSearchField,
  mountSelect,
  mountSpinner,
  mountText,
} from "@openchamber/sdk/ui";
import {
  badgeForOpenCount,
  buildAttachItem,
  buildSessionText,
  isOpenWorkItem,
} from "../attach-logic.mjs";
import { MAPPING_STORAGE_KEYS, mergeMapping } from "../mapping-logic.mjs";
import { parseCommandArgs, resolveWorkItem } from "../resolve-logic.mjs";
import {
  browseUrl,
  isIdentifierQuery,
  isValidSlug,
  normalizeWorkItem,
  parseWorkItemsEnvelope,
  projectsPath,
  rateLimitDelayMs,
  STATE_GROUPS,
  workItemByIdentifierPath,
  workItemsPath,
  workItemsQuery,
} from "../browse-logic.mjs";

type Row = { id: string; identifier: string; title: string; state: string; url: string };
type Page = { kind: "offset" | "cursor"; next: number | string } | null;

const REQUEST_TIMEOUT_MS = 20000;
const SEARCH_DEBOUNCE_MS = 300;
const RATE_LIMIT_RETRIES = 3;

const host = connectHost();
const root = document.querySelector("#root")!;
let mounted: Array<{ dispose: () => void }> = [];
let results: Array<{ dispose: () => void }> = [];
let listBox: HTMLElement | null = null;
let footerBox: HTMLElement | null = null;

const clear = (handles: Array<{ dispose: () => void }>) => {
  for (const block of handles) block.dispose();
  handles.length = 0;
};

const div = () => {
  const el = document.createElement("div");
  el.style.marginBottom = "8px";
  root.append(el);
  return el;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function apiGet(gen: number, path: string, query?: Record<string, string>): Promise<{ status: number; body: string }> {
  const call = host.request({ method: "GET", path, query });
  const timeout = sleep(REQUEST_TIMEOUT_MS).then(() => {
    throw new Error(`Plane did not answer within ${REQUEST_TIMEOUT_MS / 1000}s`);
  });
  const result = await Promise.race([call, timeout]);
  if (gen !== generation) throw new Error("stale");
  return result;
}

// 429 carries no headers on the host channel, so Retry-After is honored
// best-effort (undefined here) with exponential backoff; then surf a Retry.
async function apiGetWithBackoff(gen: number, path: string, query?: Record<string, string>, note?: (n: number) => void) {
  let result = await apiGet(gen, path, query);
  for (let attempt = 0; attempt < RATE_LIMIT_RETRIES && result.status === 429; attempt += 1) {
    note?.(attempt + 1);
    await sleep(rateLimitDelayMs({ attempt }));
    result = await apiGet(gen, path, query);
  }
  return result;
}

const refreshBadge = () => {
  void host.setBadge(badgeForOpenCount(connected, openCount)).catch(() => {});
};

// Remembered mapping (#7): workspace slug + default project persist across
// restarts via the host.storage cache. Reads merge settings-over-storage
// (mergeMapping); writes update both. The cache is best-effort: a storage
// failure leaves the in-memory settings untouched.
async function readStoredMapping() {
  try {
    const [slug, defaultProject] = await Promise.all([
      host.storage.get(MAPPING_STORAGE_KEYS.slug),
      host.storage.get(MAPPING_STORAGE_KEYS.defaultProject),
    ]);
    return {
      slug: typeof slug === "string" ? slug : "",
      defaultProject: typeof defaultProject === "string" ? defaultProject : "",
    };
  } catch {
    return { slug: "", defaultProject: "" };
  }
}

async function persistMapping(mapping: { slug: string; defaultProject: string }) {
  try {
    await Promise.all([
      host.storage.set(MAPPING_STORAGE_KEYS.slug, mapping.slug),
      host.storage.set(MAPPING_STORAGE_KEYS.defaultProject, mapping.defaultProject),
    ]);
  } catch {
    // Ignore: settings stay the source of truth for this run.
  }
}

const selectedRow = () => rows.find((r) => r.id === selectedId) ?? null;

const selectedChip = () => {
  const row = selectedRow();
  if (!row) return null;
  return {
    row,
    chip: buildAttachItem({ slug: settings.slug, identifier: row.identifier, title: row.title }),
  };
};

const say = (gen: number, tone: "info" | "success" | "error", note: string) => {
  if (gen !== generation) return;
  actionTone = tone;
  actionNote = note;
  renderResults(gen, "", false);
};

async function attachSelected(gen: number) {
  const found = selectedChip();
  if (!found) return;
  try {
    await host.attach(found.chip);
    if (gen !== generation) return;
    await host.close(); // dismisses the attach dialog; no-op on the rail
    say(gen, "success", `Attached ${found.row.identifier} to the chat box.`);
  } catch (error) {
    say(gen, "error", error instanceof HostRequestError ? `${error.code}: ${error.message}` : String(error));
  }
}

async function startSessionFromSelected(gen: number) {
  const found = selectedChip();
  if (!found) return;
  const text = buildSessionText({
    identifier: found.row.identifier,
    title: found.row.title,
    url: found.chip.url,
    state: found.row.state,
  });
  try {
    const result = await host.startSession({ ...found.chip, text });
    if (gen !== generation) return;
    if (result.sessionId) say(gen, "success", `Started a session for ${found.row.identifier}.`);
    else say(gen, "error", `Session not created (${result.failure ?? "unknown reason"}); nothing else was made.`);
  } catch (error) {
    say(gen, "error", error instanceof HostRequestError ? `${error.code}: ${error.message}` : String(error));
  }
}

async function linkSelected(gen: number) {
  const found = selectedChip();
  if (!found) return;
  try {
    await host.sessionLink(found.chip);
    say(gen, "success", `Linked ${found.row.identifier} to the open session.`);
  } catch (error) {
    if (error instanceof HostRequestError && error.code === "NO_SESSION") {
      say(gen, "info", "No open session — open or start a session first, then link.");
      return;
    }
    say(gen, "error", error instanceof HostRequestError ? `${error.code}: ${error.message}` : String(error));
  }
}

let generation = 0;
let settings = { slug: "", defaultProject: "" };
let connected = false;
let account: string | null = null;
let meId: string | null = null;
let filters = { search: "", stateGroup: "", mine: false, projectId: "" };
let projects: Array<{ id: string; name: string }> = [];
let rows: Row[] = [];
let page: Page = null;
let selectedId: string | null = null;
let openCount = 0;
let actionNote = "";
let actionTone: "info" | "success" | "error" = "info";
let statusNote = "";
let searchTimer: ReturnType<typeof setTimeout> | null = null;

const paint = async () => {
  const gen = ++generation;
  clear(mounted);
  clear(results);
  listBox = null;
  footerBox = null;
  if (!connected) {
    openCount = 0;
    refreshBadge();
    mounted.push(mountEmpty(root, {
      title: "Not connected",
      body: "Connect Plane in Settings → Integrations → Plane.",
    }));
    return;
  }
  if (!settings.slug) {
    openCount = 0;
    refreshBadge();
    mounted.push(mountEmpty(root, {
      title: "No workspace slug",
      body: "Set Workspace slug in Settings → Integrations → Plane.",
    }));
    return;
  }
  if (!isValidSlug(settings.slug)) {
    openCount = 0;
    refreshBadge();
    mounted.push(mountBanner(root, {
      tone: "error",
      title: "Invalid workspace slug",
      body: `“${settings.slug}” is not a valid workspace slug. Fix it in Settings → Integrations → Plane.`,
    }));
    return;
  }
  const slug = settings.slug;
  mounted.push(mountText(root, { text: `Connected as ${account ?? "Plane user"}.` }));
  const spinner = mountSpinner(root, { label: "Loading Plane projects" });
  mounted.push(spinner);
  try {
    await loadAccount(gen);
    await loadProjects(gen, slug);
  } catch (error) {
    if (gen !== generation) return;
    spinner.dispose();
    mounted.splice(mounted.indexOf(spinner), 1);
    renderFatal(String(error));
    return;
  }
  if (gen !== generation) return;
  spinner.dispose();
  mounted.splice(mounted.indexOf(spinner), 1);
  if (projects.length === 0) {
    openCount = 0;
    refreshBadge();
    mounted.push(mountEmpty(root, { title: "No projects", body: `Workspace “${slug}” has no projects.` }));
    return;
  }
  if (!projects.some((p) => p.id === filters.projectId)) {
    // needs-tenant: confirm whether Default project holds an id or a name.
    filters.projectId =
      projects.find((p) => p.id === settings.defaultProject || p.name === settings.defaultProject)?.id ?? projects[0]!.id;
  }
  const searchBox = div();
  const projectBox = div();
  const stateBox = div();
  const mineBox = div();
  listBox = div();
  footerBox = div();
  mounted.push(mountSearchField(searchBox, {
    value: filters.search,
    placeholder: "Search text or identifier, e.g. PROJ-142",
    label: "Search work items",
    onChange: (value) => {
      filters.search = value;
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(() => void reload(gen, slug, false), SEARCH_DEBOUNCE_MS);
    },
  }));
  mounted.push(mountSelect(projectBox, {
    label: "Project",
    value: filters.projectId,
    options: projects.map((p) => ({ id: p.id, label: p.name })),
    onChange: (id) => {
      filters.projectId = id;
      void reload(gen, slug, false);
    },
  }));
  mounted.push(mountSelect(stateBox, {
    label: "State group",
    value: filters.stateGroup || null,
    options: [{ id: "", label: "All" }, ...STATE_GROUPS.map((g) => ({ id: g, label: g }))],
    onChange: (id) => {
      filters.stateGroup = id;
      void reload(gen, slug, false);
    },
  }));
  mounted.push(mountCheckbox(mineBox, {
    label: "Assigned to me",
    checked: filters.mine,
    onChange: (checked) => {
      filters.mine = checked;
      void reload(gen, slug, false);
    },
  }));
  mounted.push(mountText(footerBox, { text: "Select a row, then open, attach, start a session, or link it." }));
  await reload(gen, slug, false);
};

async function loadAccount(gen: number) {
  const result = await apiGet(gen, "/api/v2/users/me/");
  if (result.status !== 200) {
    meId = null;
    return;
  }
  const me = JSON.parse(result.body) as { display_name?: string; id?: string };
  if (typeof me.display_name === "string") account = me.display_name;
  meId = typeof me.id === "string" ? me.id : null;
}

async function loadProjects(gen: number, slug: string) {
  const result = await apiGetWithBackoff(gen, projectsPath(slug));
  if (result.status === 404) throw new Error(`Unknown workspace slug “${slug}”. Check Settings → Integrations → Plane.`);
  if (result.status !== 200) throw new Error(`Plane answered ${result.status} for the project list.`);
  const payload = JSON.parse(result.body) as { data?: Array<{ id?: string; name?: string }> };
  projects = (Array.isArray(payload?.data) ? payload.data : [])
    .filter((p) => typeof p?.id === "string")
    .map((p) => ({ id: p.id as string, name: typeof p.name === "string" && p.name ? p.name : (p.id as string) }));
}

const currentQuery = (nextPage: Page) => {
  const query = workItemsQuery({
    search: filters.search || undefined,
    stateGroup: filters.stateGroup || undefined,
    // needs-tenant: confirm assignee_id accepts the users/me id for "my" work.
    assigneeId: filters.mine ? meId ?? undefined : undefined,
    offset: nextPage?.kind === "offset" ? String(nextPage.next) : undefined,
  });
  // needs-tenant: confirm the cursor continuation params.
  if (nextPage?.kind === "cursor") {
    query.paginate = "cursor";
    query.cursor = String(nextPage.next);
  }
  return query;
};

async function reload(gen: number, slug: string, append: boolean) {
  if (!listBox || !footerBox || gen !== generation) return;
  if (!append) {
    rows = [];
    page = null;
    selectedId = null;
    openCount = 0;
    actionNote = "";
  }
  if (filters.mine && !meId) {
    renderResults(gen, `Could not determine your account id, showing unfiltered.`, true);
    return;
  }
  clear(results);
  const spinner = mountSpinner(listBox, { label: append ? "Loading more work items" : "Loading work items" });
  results.push(spinner);
  try {
    const result = await apiGetWithBackoff(gen, workItemsPath(slug, filters.projectId), currentQuery(append ? page : null), (n) => {
      statusNote = `Plane is rate-limiting requests (retry ${n}).`;
    });
    statusNote = "";
    if (result.status === 429) {
      renderResults(gen, "Plane is rate-limiting requests. Wait a moment, then retry.", true);
      return;
    }
    if (result.status === 404) {
      renderResults(gen, `Project not found in workspace “${slug}”.`, true);
      return;
    }
    if (result.status !== 200) throw new Error(`Plane answered ${result.status} for the work-item list.`);
    const parsed = parseWorkItemsEnvelope(JSON.parse(result.body));
    page = parsed.page;
    const seen = new Set(rows.map((r) => r.id));
    for (const item of parsed.items) {
      const row = normalizeWorkItem(item);
      if (row && !seen.has(row.id)) {
        seen.add(row.id);
        rows.push({ ...row, url: browseUrl(slug, row.identifier) });
        if (isOpenWorkItem(item)) openCount += 1;
      }
    }
    // Identifier queries also fetch the exact work item directly: v2 ?search=
    // matches names only, so PROJ-142 might otherwise miss (#3 spike notes).
    if (!append && isIdentifierQuery(filters.search)) {
      const direct = await apiGet(gen, workItemByIdentifierPath(slug, filters.search.trim()));
      if (direct.status === 200) {
        const body = JSON.parse(direct.body) as unknown;
        const single = Array.isArray((body as { data?: unknown })?.data)
          ? (body as { data: unknown[] }).data[0]
          : body;
        const row = normalizeWorkItem(single);
        if (row && !seen.has(row.id)) {
          seen.add(row.id);
          rows.unshift({ ...row, url: browseUrl(slug, row.identifier) });
          if (isOpenWorkItem(single)) openCount += 1;
        }
      }
    }
    renderResults(gen, "", false);
  } catch (error) {
    if (gen !== generation) return;
    const text = error instanceof HostRequestError ? `${error.code}: ${error.message}` : String(error);
    renderResults(gen, text === "Error: stale" ? "" : text, text !== "Error: stale");
  }
}

function renderResults(gen: number, error: string, showRetry: boolean) {
  if (!listBox || !footerBox || gen !== generation) return;
  clear(results);
  refreshBadge();
  if (statusNote) results.push(mountBanner(listBox, { tone: "warning", title: statusNote }));
  if (actionNote) results.push(mountBanner(listBox, { tone: actionTone, title: actionNote }));
  if (error) {
    results.push(mountBanner(listBox, { tone: "error", title: "Could not load work items", body: error }));
    if (showRetry) {
      results.push(mountButton(footerBox, {
        label: "Retry",
        variant: "outline",
        size: "sm",
        onClick: () => void reload(gen, settings.slug, false),
      }));
    }
    return;
  }
  results.push(mountList(listBox, {
    ariaLabel: "Plane work items",
    emptyText: "No work items match.",
    selectedId,
    items: rows.map((r) => ({ id: r.id, leading: r.identifier, title: r.title, subtitle: r.state })),
    onSelect: (id) => {
      selectedId = id;
      actionNote = "";
      renderResults(gen, "", false);
    },
  }));
  const picked = selectedRow();
  results.push(mountButton(footerBox, {
    label: "Open in Plane",
    variant: "outline",
    size: "sm",
    disabled: !picked,
    onClick: () => {
      if (picked) void host.openUrl(picked.url);
    },
  }));
  results.push(mountButton(footerBox, {
    label: "Attach chip",
    variant: "outline",
    size: "sm",
    disabled: !picked,
    onClick: () => void attachSelected(gen),
  }));
  results.push(mountButton(footerBox, {
    label: "Start session",
    variant: "outline",
    size: "sm",
    disabled: !picked,
    onClick: () => void startSessionFromSelected(gen),
  }));
  results.push(mountButton(footerBox, {
    label: "Link to open session",
    variant: "outline",
    size: "sm",
    disabled: !picked,
    onClick: () => void linkSelected(gen),
  }));
  if (page !== null) {
    results.push(mountButton(footerBox, {
      label: "Load more",
      variant: "outline",
      size: "sm",
      onClick: () => void reload(gen, settings.slug, true),
    }));
  }
}

function renderFatal(message: string) {
  if (message === "Error: stale") return;
  mounted.push(mountBanner(root, { tone: "error", title: "Could not load Plane projects", body: message }));
  const box = div();
  mounted.push(mountButton(box, {
    label: "Retry",
    variant: "outline",
    size: "sm",
    onClick: () => void paint(),
  }));
}

host.onReady((ctx) => {
  applyHostReady(ctx, document.documentElement);
  if (ctx.connection) {
    connected = ctx.connection.connected;
    account = ctx.connection.account ?? null;
  }
  const fromSettings = {
    slug: (ctx.settings?.["workspace-slug"] ?? "").trim(),
    defaultProject: (ctx.settings?.["default-project"] ?? "").trim(),
  };
  // One paint after the storage read so the first render already uses the
  // remembered mapping; returning users are not asked twice.
  void (async () => {
    settings = mergeMapping(fromSettings, await readStoredMapping());
    void persistMapping(settings);
    void paint();
  })();
});
host.onSettings((next) => {
  // An explicit settings change is the truth (blanks clear the cache too),
  // so shape it directly, persist both keys, and re-target browse + resolve.
  settings = {
    slug: (next?.["workspace-slug"] ?? "").trim(),
    defaultProject: (next?.["default-project"] ?? "").trim(),
  };
  void persistMapping(settings);
  void paint();
});
let previousConnection: string | undefined;
host.onConnection((connection) => {
  const key = JSON.stringify(connection);
  if (key === previousConnection) return;
  previousConnection = key;
  connected = connection.connected;
  account = connection.account ?? null;
  void paint();
});

// Slash command: "/plane PROJ-142" attaches that work item without opening
// the panel. Unknown/bad identifiers resolve to null (nothing found, no
// chip, no error toast), so the handler never throws.
host.onResolve(async (request) => {
  const identifier = parseCommandArgs(request?.args);
  const slug = settings.slug;
  if (!identifier || !isValidSlug(slug)) return null;
  try {
    const result = await host.request({ method: "GET", path: workItemByIdentifierPath(slug, identifier) });
    if (result.status !== 200) return null;
    const row = resolveWorkItem(JSON.parse(result.body));
    if (!row) return null;
    return buildAttachItem({ slug, identifier: row.identifier, title: row.title });
  } catch {
    return null;
  }
});
