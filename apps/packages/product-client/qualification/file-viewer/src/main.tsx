import "@proliferate/design/product.css";

import { AnyHarnessRuntime, AnyHarnessWorkspace } from "@anyharness/sdk-react";
import type { Workspace } from "@anyharness/sdk";
import type {
  DesktopBridge,
  DesktopFilesBridge,
  DesktopNativeUiBridge,
  NativeMenuItem,
  OpenTarget,
} from "@proliferate/product-client/host/desktop-bridge";
import type { ProductHost } from "@proliferate/product-client/host/product-host";
import { ProductHostProvider } from "@proliferate/product-client/host/ProductHostProvider";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import ReactDOM from "react-dom/client";
import { FileViewerPlaygroundPage } from "#product/pages/FileViewerPlaygroundPage";
import type { ProductResolvedWorkspaceConnection } from "#product/lib/access/anyharness/resolve-workspace-connection";
import { ProductWorkspaceConnectionProvider } from "#product/providers/ProductWorkspaceConnectionProvider";
import { WorkspacePathProvider } from "#product/providers/WorkspacePathProvider";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useWorkspaceViewerTabsStore } from "#product/stores/editor/workspace-viewer-tabs-store";

type FixtureHost = "desktop" | "web";
type FixtureOrigin = "local" | "remote";

interface FixtureCounters {
  clipboard: number;
  discovery: number;
  home: number;
  inspection: number;
  nativeMenu: number;
  open: number;
  reveal: number;
}

interface NativeMenuItemSnapshot {
  kind: "action" | "separator" | "submenu";
  id?: string;
  label?: string;
  enabled?: boolean;
  items?: NativeMenuItemSnapshot[];
}

interface FileReferenceRoutingFixtureSnapshot {
  counters: FixtureCounters;
  clipboardValues: string[];
  nativeMenuItems: NativeMenuItemSnapshot[];
  openedPaths: Array<{ targetId: string; path: string }>;
  revealedPaths: string[];
}

interface FileReferenceRoutingFixture {
  snapshot(): FileReferenceRoutingFixtureSnapshot;
}

declare global {
  interface Window {
    __fileReferenceRoutingFixture: FileReferenceRoutingFixture;
  }
}

const FIXTURE_WORKSPACE_ID = "fixture-workspace";
const FIXTURE_RUNTIME_WORKSPACE_ID = "fixture-runtime-workspace";
const FIXTURE_RUNTIME_URL = "https://file-reference-routing.invalid";
const FIXTURE_WORKSPACE_ROOT = "/fixture-workspace";
const FIXED_TIME = "2026-08-19T12:00:00.000Z";

const params = new URLSearchParams(window.location.search);
const fixtureHost: FixtureHost = params.get("host") === "web" ? "web" : "desktop";
const fixtureOrigin: FixtureOrigin = params.get("origin") === "remote" ? "remote" : "local";

const counters: FixtureCounters = {
  clipboard: 0,
  discovery: 0,
  home: 0,
  inspection: 0,
  nativeMenu: 0,
  open: 0,
  reveal: 0,
};
const clipboardValues: string[] = [];
const openedPaths: Array<{ targetId: string; path: string }> = [];
const revealedPaths: string[] = [];
let nativeMenuItems: NativeMenuItemSnapshot[] = [];

const editorTarget: OpenTarget = {
  id: "fixture-editor",
  label: "Fixture Editor",
  kind: "editor",
  iconId: "vscode",
};

const files: DesktopFilesBridge = {
  pickDirectory: async () => ({ kind: "cancelled" }),
  getHomeDirectory: async () => {
    counters.home += 1;
    return "/Users/fixture";
  },
  inspectPath: async () => {
    counters.inspection += 1;
    return { kind: "file" };
  },
  getDragPasteboardChangeCount: async () => -1,
  readDroppedPaths: async () => ({ changeCount: -1, entries: [] }),
  listAvailableEditors: async () => [],
  listOpenTargets: async () => {
    counters.discovery += 1;
    return [editorTarget];
  },
  openTarget: async (targetId, path) => {
    counters.open += 1;
    openedPaths.push({ targetId, path });
  },
  reveal: async (path) => {
    counters.reveal += 1;
    revealedPaths.push(path);
  },
  openTerminal: async () => {},
};

const nativeUi = {
  showContextMenu: async (items: NativeMenuItem[]) => {
    counters.nativeMenu += 1;
    nativeMenuItems = items.map(snapshotNativeMenuItem);
    // Exercise the shipped DOM fallback from the same context-menu event.
    return false;
  },
  subscribeMenuCommands: () => () => {},
  setRunningAgentCount: async () => {},
  setWorkspaceActivity: async () => {},
  setZoom: async () => {},
  applyMacosWindowChrome: async () => {},
  isMainWebviewAvailable: () => false,
  revealCurrentWindow: async () => {},
} satisfies DesktopNativeUiBridge;

const desktop = fixtureHost === "desktop"
  ? ({ files, nativeUi } as unknown as DesktopBridge)
  : null;

const host: ProductHost = {
  surface: fixtureHost,
  deployment: { apiBaseUrl: "https://file-reference-routing-cloud.invalid" },
  auth: {
    authRequired: false,
    state: { status: "anonymous", methods: [] },
    restoreSession: async () => {},
    startLogin: async () => ({ provider: "fixture", source: "qualification" }),
    finishLogin: async () => {},
    cancelLogin: async () => {},
    logout: async () => ({ provider: "fixture" }),
  },
  cloud: {
    client: null,
    getSandboxGatewayAccessToken: async () => {
      throw new Error("File-reference qualification has no Cloud transport.");
    },
  },
  storage: {
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  },
  links: {
    openExternal: async () => {},
    buildReturnUrl: () => "https://file-reference-routing.invalid/callback",
    observeInboundEntries: () => () => {},
  },
  clipboard: {
    writeText: async (value) => {
      counters.clipboard += 1;
      clipboardValues.push(value);
    },
  },
  telemetry: {
    track: () => {},
    captureException: () => {},
    setUser: () => {},
    setTag: () => {},
    routeChanged: () => {},
    getSupportContext: () => ({ clientReleaseId: "file-reference-routing-qualification" }),
    getAnonymousInstallId: async () => "file-reference-routing-qualification",
  },
  desktop,
};

const productConnection: ProductResolvedWorkspaceConnection = {
  connection: {
    runtimeUrl: FIXTURE_RUNTIME_URL,
    anyharnessWorkspaceId: FIXTURE_RUNTIME_WORKSPACE_ID,
    runtimeGeneration: 1,
    runtimeAccessKind: fixtureOrigin === "local" ? "direct" : "proliferate-gateway",
    ...(fixtureOrigin === "remote" ? { webSocketAuthTransport: "protocol" as const } : {}),
  },
  filesystemOrigin: fixtureOrigin === "local" ? "desktop-local" : "remote",
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnMount: false,
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
    },
  },
});

const workspace: Workspace = {
  id: FIXTURE_RUNTIME_WORKSPACE_ID,
  kind: "local",
  availability: "available",
  lifecycleState: "active",
  surface: "standard",
  path: FIXTURE_WORKSPACE_ROOT,
  repoRootId: "fixture-repo-root",
  createdAt: FIXED_TIME,
  updatedAt: FIXED_TIME,
};

const fixtureFetch: typeof globalThis.fetch = async (input) => {
  const rawUrl = typeof input === "string"
    ? input
    : input instanceof URL
      ? input.href
      : input.url;
  const url = new URL(rawUrl);
  if (url.origin !== FIXTURE_RUNTIME_URL) {
    throw new Error(`External network is forbidden in file-reference qualification: ${url.origin}`);
  }

  if (url.pathname.endsWith(`/v1/workspaces/${FIXTURE_RUNTIME_WORKSPACE_ID}`)) {
    return jsonResponse(workspace);
  }
  if (url.pathname.endsWith("/files/stat")) {
    const path = url.searchParams.get("path") ?? "";
    return jsonResponse({
      kind: path === "" ? "directory" : "file",
      path,
      isText: path !== "",
      sizeBytes: path === "" ? null : 62,
      modifiedAt: FIXED_TIME,
    });
  }
  if (url.pathname.endsWith("/files/file")) {
    const path = url.searchParams.get("path") ?? "src/example.ts";
    return jsonResponse({
      content: "export const fixture = 'file reference routing';\n",
      encoding: "utf-8",
      isText: true,
      kind: "file",
      modifiedAt: FIXED_TIME,
      path,
      sizeBytes: 49,
      tooLarge: false,
      versionToken: "fixture-v1",
    });
  }
  if (url.pathname.endsWith("/git/status")) {
    return jsonResponse({
      actions: {
        canCommit: false,
        canCreateBranchWorkspace: false,
        canCreateDraftPullRequest: false,
        canCreatePullRequest: false,
        canPush: false,
        pushLabel: "Push",
      },
      ahead: 0,
      behind: 0,
      clean: true,
      conflicted: false,
      currentBranch: "main",
      detached: false,
      files: [],
      headOid: "0000000000000000000000000000000000000000",
      operation: "none",
      repoRootPath: FIXTURE_WORKSPACE_ROOT,
      summary: {
        additions: 0,
        changedFiles: 0,
        conflictedFiles: 0,
        deletions: 0,
        includedFiles: 0,
      },
      workspaceId: FIXTURE_RUNTIME_WORKSPACE_ID,
      workspacePath: FIXTURE_WORKSPACE_ROOT,
    });
  }
  if (url.pathname.endsWith("/files/search")) {
    return jsonResponse({ results: [] });
  }

  throw new Error(`Unscripted AnyHarness request: ${url.pathname}${url.search}`);
};

window.fetch = fixtureFetch;
window.__fileReferenceRoutingFixture = {
  snapshot: () => ({
    counters: { ...counters },
    clipboardValues: [...clipboardValues],
    nativeMenuItems: structuredClone(nativeMenuItems),
    openedPaths: openedPaths.map((entry) => ({ ...entry })),
    revealedPaths: [...revealedPaths],
  }),
};
document.documentElement.dataset.proliferateClient = fixtureHost;

useSessionSelectionStore.setState({
  _hydrated: true,
  selectedLogicalWorkspaceId: FIXTURE_WORKSPACE_ID,
  selectedWorkspaceId: FIXTURE_WORKSPACE_ID,
});
useWorkspaceViewerTabsStore.getState().prepareWorkspace({
  workspaceUiKey: FIXTURE_WORKSPACE_ID,
  materializedWorkspaceId: FIXTURE_WORKSPACE_ID,
});

const resolveProductConnection = async (): Promise<ProductResolvedWorkspaceConnection> => (
  productConnection
);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <BrowserRouter>
    <QueryClientProvider client={queryClient}>
      <ProductHostProvider host={host}>
        <AnyHarnessRuntime
          runtimeUrl={FIXTURE_RUNTIME_URL}
          cacheScopeKey="file-reference-routing-qualification"
          fetch={fixtureFetch}
        >
          <ProductWorkspaceConnectionProvider resolveConnection={resolveProductConnection}>
            <AnyHarnessWorkspace
              workspaceId={FIXTURE_WORKSPACE_ID}
              resolveConnection={async () => productConnection.connection}
            >
              <WorkspacePathProvider>
                <Routes>
                  <Route path="/playground/files" element={<FileViewerPlaygroundPage />} />
                </Routes>
              </WorkspacePathProvider>
            </AnyHarnessWorkspace>
          </ProductWorkspaceConnectionProvider>
        </AnyHarnessRuntime>
      </ProductHostProvider>
    </QueryClientProvider>
  </BrowserRouter>,
);

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function snapshotNativeMenuItem(item: NativeMenuItem): NativeMenuItemSnapshot {
  if (item.kind === "separator") {
    return { kind: "separator" };
  }
  if (item.kind === "submenu") {
    return {
      kind: "submenu",
      label: item.label,
      enabled: item.enabled !== false,
      items: item.items.map(snapshotNativeMenuItem),
    };
  }
  return {
    kind: "action",
    id: item.id,
    label: item.label,
    enabled: item.enabled !== false,
  };
}
