// Checkable seam for ticket #4: the extension installs iff the manifest parses
// and the panel script is a single classic IIFE bundle. Run: node check.mjs
import { readFileSync, existsSync } from "node:fs";
import { parseManifestJson } from "@openchamber/sdk/schemas";

const dir = new URL("./", import.meta.url);
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exitCode = 1; };
const ok = (msg) => console.log(`ok: ${msg}`);

const pkgPath = new URL("./package.json", dir);
if (!existsSync(pkgPath)) { fail("plane/package.json missing"); process.exit(1); }
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const parsed = parseManifestJson(JSON.stringify(pkg));
if (!parsed.ok) fail(`SDK parseManifestJson rejected manifest: ${parsed.code} ${parsed.message}`);
else ok("SDK parseManifestJson accepts manifest");
const oc = pkg.openchamber;
if (oc?.apiVersion !== 1) fail("openchamber.apiVersion must be 1"); else ok("apiVersion is 1");
const c = oc?.contributes ?? {};
for (const [path, label] of [
  [c.panel?.entry, "panel.entry"],
  [c.attach, "attach"],
  [c.integration?.oauth?.apiOrigin, "integration.oauth.apiOrigin"],
  [c.integration?.oauth?.authorizeUrl, "integration.oauth.authorizeUrl"],
  [c.integration?.oauth?.tokenUrl, "integration.oauth.tokenUrl"],
  [c.integration?.oauth?.account?.path, "integration.oauth.account.path"],
  [c.integration?.oauth?.account?.name, "integration.oauth.account.name"],
]) if (!path) fail(`contributes.${label} missing`); else ok(`contributes.${label} = ${path}`);
if (c.integration?.oauth?.apiOrigin !== "https://api.plane.so") fail("apiOrigin must be https://api.plane.so");
for (const s of ["read", "projects.work_items:read", "projects:read", "projects.states:read", "projects.members:read"])
  if (!c.integration?.oauth?.scopes?.includes(s)) fail(`oauth scope missing: ${s}`); else ok(`scope ${s}`);
for (const cap of ["prompt", "sessions"])
  if (!c.capabilities?.includes(cap)) fail(`capability missing: ${cap}`); else ok(`capability ${cap}`);
for (const id of ["workspace-slug", "default-project"])
  if (!c.integration?.settings?.some((f) => f.id === id)) fail(`settings field missing: ${id}`); else ok(`setting ${id}`);
if (!c.commands?.some((cmd) => cmd.name === "plane")) fail('slash command "plane" missing'); else ok('command "plane"');

const html = new URL("./panel/index.html", dir);
if (!existsSync(html)) fail("panel/index.html missing"); else ok("panel/index.html exists");
const js = new URL("./panel/main.js", dir);
if (!existsSync(js)) fail("panel/main.js missing (run the bundler)"); else {
  const src = readFileSync(js, "utf8");
  if (/^\s*(import|export)\s/m.test(src)) fail("panel/main.js must be a classic script, not an ES module");
  else ok("panel/main.js is a classic script");
  if (!src.includes("Not connected")) fail("panel/main.js missing not-connected empty state"); else ok("not-connected empty state present");
}
if (process.exitCode) console.error("CHECK FAILED"); else console.log("CHECK PASSED");
