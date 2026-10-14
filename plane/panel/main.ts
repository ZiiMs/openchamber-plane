import { connectHost, HostRequestError } from "@openchamber/sdk";
import { applyHostReady, mountBanner, mountEmpty, mountSpinner, mountText } from "@openchamber/sdk/ui";

type PlaneMe = { display_name?: string };

const host = connectHost();
const root = document.querySelector("#root")!;
let mounted: Array<{ dispose: () => void }> = [];

const clear = () => {
  for (const block of mounted) block.dispose();
  mounted = [];
};

let generation = 0;
const paint = async (connected: boolean, account: string | null) => {
  const currentGeneration = ++generation;
  clear();
  if (!connected) {
    mounted.push(mountEmpty(root, {
      title: "Not connected",
      body: "Connect Plane in Settings → Integrations → Plane.",
    }));
    return;
  }
  const spinner = mountSpinner(root, { label: "Loading Plane account" });
  mounted.push(spinner);
  try {
    const result = await host.request({ method: "GET", path: "/api/v2/users/me/" });
    if (currentGeneration !== generation) return;
    spinner.dispose();
    if (result.status !== 200) {
      mounted.push(mountBanner(root, { tone: "error", title: `Plane answered ${result.status}` }));
      return;
    }
    const me = JSON.parse(result.body) as PlaneMe;
    mounted.push(mountText(root, { text: `Connected as ${me.display_name ?? account ?? "Plane user"}.` }));
  } catch (error) {
    if (currentGeneration !== generation) return;
    spinner.dispose();
    const text = error instanceof HostRequestError ? `${error.code}: ${error.message}` : String(error);
    mounted.push(mountBanner(root, { tone: "error", title: "Request failed", body: text }));
  }
};

host.onReady((ctx) => {
  applyHostReady(ctx, document.documentElement);
});
let previousConnection: string | undefined;
host.onConnection((connection) => {
  const key = JSON.stringify(connection);
  if (key === previousConnection) return;
  previousConnection = key;
  void paint(connection.connected, connection.account ?? null);
});

// Work item identifier resolution lands in #7; until then the command finds nothing.
host.onResolve(async () => null);
