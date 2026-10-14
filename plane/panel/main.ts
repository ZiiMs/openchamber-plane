import { connectHost, HostRequestError } from "@openchamber/sdk";
import {
  applyHostReady,
  mountBadge,
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
  badgeForListResult,
  buildAttachItem,
  buildSessionText,
  isOpenWorkItem,
} from "../attach-logic.mjs";
import { MAPPING_STORAGE_KEYS, mergeMapping } from "../mapping-logic.mjs";
import { parseCommandArgs, resolveWorkItem } from "../resolve-logic.mjs";
import {
  browseUrl,
  groupRowsByState,
  isIdentifierQuery,
  isValidSlug,
  normalizeStates,
  normalizeWorkItem,
  parseDiscoveredWorkspaces,
  parseWorkItemsEnvelope,
  projectsPath,
  rateLimitDelayMs,
  sectionLabel,
  statesPath,
  statesQuery,
  stateTone,
  unwrapSingle,
  workItemByIdentifierPath,
  workItemsPath,
  workItemsQuery,
  WORKSPACES_DISCOVERY_PATH,
} from "../browse-logic.mjs";
import { detailQuery, parseDescriptionHtml, shapeWorkItemDetail } from "../detail-logic.mjs";

type Row = { id: string; identifier: string; title: string; state: string; stateGroup: string | null; url: string };
type State = { id: string; name: string; group: string | null; sequence: number | null };
type RichNode = { tag?: string; text?: string; href?: string; children?: RichNode[] };
type Detail = {
  identifier: string;
  title: string;
  state: string;
  stateGroup: string | null;
  priority: string | null;
  assignees: string[];
  labels: string[];
  startDate: string | null;
  targetDate: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  projectId: string | null;
  description: string;
};
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
  void host.setBadge(badgeForListResult(connected, serverTotal, openCount)).catch(() => {});
};

// Remembered mapping (issue #7): workspace slug + default project persist across
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

const showNotice = (gen: number, tone: "info" | "success" | "error", note: string) => {
  if (gen !== generation) return;
  actionTone = tone;
  actionNote = note;
  renderResults(gen, "", false);
};

const describeError = (error: unknown) =>
  error instanceof HostRequestError ? `${error.code}: ${error.message}` : String(error);

const footerButton = (label: string, onClick: () => void, disabled = false) =>
  mountButton(footerBox, { label, variant: "outline", size: "sm", disabled, onClick });

async function attachSelected(gen: number) {
  const found = selectedChip();
  if (!found) return;
  try {
    await host.attach(found.chip);
    if (gen !== generation) return;
    await host.close(); // dismisses the attach dialog; no-op on the rail
    showNotice(gen, "success", `Attached ${found.row.identifier} to the chat box.`);
  } catch (error) {
    showNotice(gen, "error", describeError(error));
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
    if (result.sessionId) showNotice(gen, "success", `Started a session for ${found.row.identifier}.`);
    else showNotice(gen, "error", `Session not created (${result.failure ?? "unknown reason"}); nothing else was made.`);
  } catch (error) {
    showNotice(gen, "error", describeError(error));
  }
}

async function linkSelected(gen: number) {
  const found = selectedChip();
  if (!found) return;
  try {
    await host.sessionLink(found.chip);
    showNotice(gen, "success", `Linked ${found.row.identifier} to the open session.`);
  } catch (error) {
    if (error instanceof HostRequestError && error.code === "NO_SESSION") {
      showNotice(gen, "info", "No open session — open or start a session first, then link.");
      return;
    }
    showNotice(gen, "error", describeError(error));
  }
}

// Closing hands focus back to the selected row: the re-render that opened the
// modal rebuilt it, so the live row is found in the list rather than remembered.
const closeDetail = () => {
  if (!modal) return;
  modal.dispose();
  modal = null;
  listBox?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')?.focus();
};

// Description rendering (issue #13): the tree from parseDescriptionHtml is
// turned into elements here — never innerHTML — so nothing in a Plane
// description can execute or carry an attribute the allow-list dropped.
const RICH_CSS = ".plane-rich p{margin:0 0 8px}.plane-rich ul,.plane-rich ol{margin:0 0 8px;padding-left:20px}.plane-rich li{margin:2px 0}.plane-rich h1{font-size:1.05rem;margin:8px 0 4px}.plane-rich h2{font-size:0.95rem;margin:8px 0 4px}.plane-rich h3{font-size:0.9rem;margin:8px 0 4px}.plane-rich code{font-family:var(--oc-mono,monospace);font-size:0.8125rem;background:var(--oc-muted-surface,rgba(127,127,127,.15));padding:1px 4px;border-radius:4px}.plane-rich pre{white-space:pre-wrap;background:var(--oc-muted-surface,rgba(127,127,127,.15));padding:8px;border-radius:6px;overflow:auto}.plane-rich pre code{background:none;padding:0}";

const ensureRichStyle = () => {
  if (document.getElementById("plane-rich-style")) return;
  const style = document.createElement("style");
  style.id = "plane-rich-style";
  style.textContent = RICH_CSS;
  document.head.append(style);
};

const renderRich = (nodes: RichNode[]): DocumentFragment => {
  const frag = document.createDocumentFragment();
  for (const node of nodes) {
    if (typeof node.text === "string") {
      frag.append(document.createTextNode(node.text));
      continue;
    }
    if (!node.tag) continue;
    const el = document.createElement(node.tag);
    if (node.tag === "a" && node.href) {
      el.setAttribute("href", node.href);
      el.style.cssText = "color:var(--oc-primary-text,var(--oc-primary));text-decoration:underline;cursor:pointer;";
      el.addEventListener("click", (event) => {
        event.preventDefault();
        void host.openUrl(node.href as string);
      });
    }
    el.append(renderRich(node.children ?? []));
    frag.append(el);
  }
  return frag;
};

// Detail modal (issue #12). The kit has no modal primitive, so it is composed
// from the host theme tokens; the row click that selects the row opens it.
const statePill = (state: string, stateGroup: string | null) => ({ label: state, tone: stateTone(stateGroup) });

const detailRow = (label: string, value: string | null, pill?: { label: string; tone: string }) => {
  if (!pill && !value) return null;
  const row = document.createElement("div");
  row.style.cssText = "display:flex;gap:8px;align-items:baseline;";
  const key = document.createElement("span");
  key.style.cssText = "flex:0 0 84px;font-size:0.75rem;color:var(--oc-muted);";
  key.textContent = label;
  row.append(key);
  if (pill) {
    const holder = document.createElement("span");
    row.append(holder);
    mountBadge(holder, pill);
  } else {
    const val = document.createElement("span");
    val.textContent = value as string;
    row.append(val);
  }
  return row;
};

async function openDetail(gen: number, row: Row) {
  closeDetail();
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;padding:12px;background:rgba(0,0,0,.45);";
  const card = document.createElement("div");
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-label", `${row.identifier} ${row.title}`);
  card.tabIndex = -1;
  card.style.cssText = "display:flex;flex-direction:column;gap:10px;width:min(100%,640px);max-height:100%;overflow:auto;padding:16px;border:1px solid var(--oc-border);border-radius:var(--oc-radius,10px);background:var(--oc-elevated);color:var(--oc-fg);box-shadow:0 16px 40px rgba(0,0,0,.35);";
  overlay.append(card);
  document.body.append(overlay);
  modal = { dispose: () => overlay.remove() };
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closeDetail();
  });
  overlay.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeDetail();
  });
  card.focus();

  const head = document.createElement("div");
  head.style.cssText = "display:flex;gap:8px;align-items:flex-start;";
  const heading = document.createElement("div");
  heading.style.cssText = "flex:1 1 auto;min-width:0;font-weight:600;";
  heading.textContent = row.title;
  head.append(heading);
  mountButton(head, { label: "Close", variant: "ghost", size: "sm", onClick: () => closeDetail() });
  card.append(head);
  const key = document.createElement("div");
  key.style.cssText = "font-family:var(--oc-mono,monospace);font-size:0.75rem;color:var(--oc-muted);";
  key.textContent = row.identifier;
  card.append(key);

  const spinner = mountSpinner(card, { label: "Loading work item" });
  let detail: Detail | null = null;
  let failure: { tone: "warning" | "error"; body: string } | null = null;
  try {
    const result = await apiGet(gen, workItemByIdentifierPath(settings.slug, row.identifier), detailQuery());
    if (result.status === 200) detail = shapeWorkItemDetail(JSON.parse(result.body)) as Detail | null;
    else if (result.status === 404) failure = { tone: "warning", body: "Plane has no such work item — it may have been archived since the list loaded." };
    else failure = { tone: "error", body: `Plane answered ${result.status} for this work item.` };
  } catch (error) {
    failure = { tone: "error", body: describeError(error) };
  }
  spinner.dispose();
  if (gen !== generation) {
    closeDetail();
    return;
  }
  if (failure) {
    mountBanner(card, {
      tone: failure.tone,
      title: "Could not load this work item",
      body: failure.body,
      action: { label: "Open in Plane", onClick: () => void host.openUrl(row.url) },
    });
  } else if (detail) {
    const body = document.createElement("div");
    body.style.cssText = "display:flex;flex-direction:column;gap:6px;";
    for (const node of [
      detailRow("State", null, statePill(detail.state, detail.stateGroup)),
      detailRow("Priority", detail.priority),
      detailRow("Assignees", detail.assignees.join(", ") || null),
      detailRow("Start", detail.startDate),
      detailRow("Target", detail.targetDate),
      detailRow("Created", detail.createdAt),
      detailRow("Updated", detail.updatedAt),
      detailRow("Project", projects.find((p) => p.id === detail.projectId)?.name ?? null),
      detailRow("Labels", detail.labels.join(", ") || null),
    ]) {
      if (node) body.append(node);
    }
    const nodes = parseDescriptionHtml(detail.description) as RichNode[];
    if (nodes.length > 0) {
      ensureRichStyle();
      const rich = document.createElement("div");
      rich.className = "plane-rich";
      rich.style.cssText = "margin-top:4px;";
      rich.append(renderRich(nodes));
      body.append(rich);
    }
    card.append(body);
  }
  const footer = document.createElement("div");
  footer.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;";
  card.append(footer);
  mountButton(footer, { label: "Open in Plane", variant: "outline", size: "sm", onClick: () => void host.openUrl(row.url) });
  mountButton(footer, { label: "Attach chip", variant: "outline", size: "sm", onClick: () => void attachSelected(gen) });
  mountButton(footer, { label: "Start session", variant: "outline", size: "sm", onClick: () => void startSessionFromSelected(gen) });
  mountButton(footer, { label: "Link to open session", variant: "outline", size: "sm", onClick: () => void linkSelected(gen) });
}

let generation = 0;
let settings = { slug: "", defaultProject: "" };
let connected = false;
let account: string | null = null;
let meId: string | null = null;
let filters = { search: "", stateId: "", mine: false, projectId: "" };
let projects: Array<{ id: string; name: string }> = [];
let states: State[] = [];
let stateSelect: ReturnType<typeof mountSelect> | null = null;
let modal: { dispose: () => void } | null = null;
let rows: Row[] = [];
let page: Page = null;
let selectedId: string | null = null;
let collapsedSections = new Set<string>();
let openCount = 0;
let serverTotal: number | null = null;
let discoveredSlugs: string[] = [];
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
  stateSelect = null;
  closeDetail();
  if (!connected) {
    openCount = 0;
    serverTotal = null;
    refreshBadge();
    mounted.push(mountEmpty(root, {
      title: "Not connected",
      body: "Connect Plane in Settings → Integrations → Plane.",
    }));
    return;
  }
  if (!settings.slug) {
    openCount = 0;
    serverTotal = null;
    refreshBadge();
    await refreshDiscoveredSlugs(gen);
    if (gen !== generation) return;
    mounted.push(mountEmpty(root, {
      title: "No workspace slug",
      body: discoveredSlugs.length === 0
        ? "Set Workspace slug in Settings → Integrations → Plane."
        : `Set Workspace slug in Settings → Integrations → Plane. Found workspaces: ${discoveredSlugs.join(", ")} — enter one as the Workspace slug.`,
    }));
    return;
  }
  if (!isValidSlug(settings.slug)) {
    openCount = 0;
    serverTotal = null;
    refreshBadge();
    mounted.push(mountBanner(root, {
      tone: "error",
      title: "Invalid workspace slug",
      body: `“${settings.slug}” is not a valid workspace slug. Fix it in Settings → Integrations → Plane.`,
    }));
    return;
  }
  const slug = settings.slug;
  // The host sends an empty account string before the name is known; `??`
  // alone would render "Connected as ." (issue #10).
  const who = typeof account === "string" && account.trim() ? account.trim() : "Plane user";
  mounted.push(mountText(root, { text: `Connected as ${who}.` }));
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
    serverTotal = null;
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
  const projectSelect = mountSelect(projectBox, {
    label: "Project",
    value: filters.projectId,
    options: projects.map((p) => ({ id: p.id, label: p.name })),
    onChange: (id) => {
      filters.projectId = id;
      filters.stateId = "";
      // The kit paints its trigger from props, so the chosen value goes back in.
      projectSelect.update({ value: id });
      void (async () => {
        await refreshStates(gen, slug, id);
        if (gen !== generation) return;
        void reload(gen, slug, false);
      })();
    },
  });
  mounted.push(projectSelect);
  stateSelect = mountSelect(stateBox, {
    label: "State",
    value: filters.stateId,
    options: stateOptions(),
    onChange: (id) => {
      filters.stateId = id;
      stateSelect?.update({ value: id });
      void reload(gen, slug, false);
    },
  });
  mounted.push(stateSelect);
  mounted.push(mountCheckbox(mineBox, {
    label: "Assigned to me",
    checked: filters.mine,
    onChange: (checked) => {
      filters.mine = checked;
      void reload(gen, slug, false);
    },
  }));
  mounted.push(mountText(footerBox, { text: "Select a row to open it." }));
  // Best effort: a states failure leaves the State control with "All" alone.
  await refreshStates(gen, slug, filters.projectId);
  await reload(gen, slug, false);
};

// Opportunistic workspace auto-discovery for the no-slug empty state: a
// best-effort slug offer. Any failure (including the expected 404 until
// upstream PR makeplane/plane#9503 merges) silently keeps the manual
// workspace-slug settings path.
async function refreshDiscoveredSlugs(gen: number) {
  discoveredSlugs = [];
  try {
    const result = await apiGet(gen, WORKSPACES_DISCOVERY_PATH);
    if (result.status !== 200) return;
    discoveredSlugs = parseDiscoveredWorkspaces(JSON.parse(result.body));
  } catch {
    discoveredSlugs = [];
  }
}

async function loadAccount(gen: number) {
  const result = await apiGet(gen, "/api/v1/users/me/");
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

const stateOptions = () => [
  { id: "", label: "All" },
  ...states.map((s) => ({ id: s.id, label: s.name, hint: s.group ?? undefined })),
];

// Best-effort states for the State control (issue #10): any failure leaves the
// filter at "All" and the list usable.
async function refreshStates(gen: number, slug: string, projectId: string) {
  states = [];
  try {
    const result = await apiGetWithBackoff(gen, statesPath(slug, projectId), statesQuery());
    if (result.status === 200) states = normalizeStates(JSON.parse(result.body));
  } catch {
    states = [];
  }
  if (gen !== generation) return;
  if (filters.stateId && !states.some((s) => s.id === filters.stateId)) filters.stateId = "";
  stateSelect?.update({ options: stateOptions(), value: filters.stateId });
}

const currentQuery = (nextPage: Page) => {
  const query = workItemsQuery({
    search: filters.search || undefined,
    stateId: filters.stateId || undefined,
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
    serverTotal = null;
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
    if (typeof parsed.totalCount === "number") serverTotal = parsed.totalCount;
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
    // matches names only, so PROJ-142 might otherwise miss (issue #3 spike notes).
    if (!append && isIdentifierQuery(filters.search)) {
      const direct = await apiGet(gen, workItemByIdentifierPath(slug, filters.search.trim()));
      if (direct.status === 200) {
        const single = unwrapSingle(JSON.parse(direct.body));
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
    const text = describeError(error);
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
      results.push(footerButton("Retry", () => void reload(gen, settings.slug, false)));
    }
    return;
  }
  const onSelect = (id: string) => {
    selectedId = id;
    actionNote = "";
    renderResults(gen, "", false);
    const picked = selectedRow();
    if (picked) void openDetail(gen, picked);
  };
  const listProps = (items: Row[]) => ({
    ariaLabel: "Plane work items",
    emptyText: "No work items match.",
    selectedId,
    // The state is a pill now, not a second line (issue #10).
    items: items.map((r) => ({ id: r.id, leading: r.identifier, title: r.title, badge: statePill(r.state, r.stateGroup) })),
    onSelect,
  });
  // Sections by state (issue #11); a flat list while a state is filtered.
  const sections = filters.stateId || rows.length === 0 ? [] : groupRowsByState(rows, states);
  if (sections.length === 0) {
    results.push(mountList(listBox, listProps(rows)));
  } else {
    for (const section of sections) {
      const collapsed = collapsedSections.has(section.state);
      const heading = document.createElement("button");
      heading.type = "button";
      heading.className = "plane-section";
      heading.style.cssText = "display:block;width:100%;text-align:left;margin:10px 0 4px;padding:0;border:0;background:none;font-size:0.75rem;color:var(--oc-muted);cursor:pointer;";
      heading.setAttribute("aria-expanded", collapsed ? "false" : "true");
      heading.textContent = `${collapsed ? "▸" : "▾"} ${sectionLabel(section)}`;
      heading.addEventListener("click", () => {
        if (collapsedSections.has(section.state)) collapsedSections.delete(section.state);
        else collapsedSections.add(section.state);
        renderResults(gen, "", false);
      });
      listBox.append(heading);
      results.push({ dispose: () => heading.remove() });
      if (!collapsed) results.push(mountList(listBox, listProps(section.rows)));
    }
  }
  if (page !== null) {
    results.push(footerButton("Load more", () => void reload(gen, settings.slug, true)));
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
