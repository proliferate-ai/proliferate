import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import {
  repairAgentsPaneRoute,
  selectAgentsPaneRoute,
  useAgentsPaneNavigationStore,
  type AgentsPaneRoute,
} from "#product/stores/agents/agents-pane-navigation-store";

const WS_A = "workspace-a";
const WS_B = "workspace-b";

function routeOf(workspaceId: string): AgentsPaneRoute {
  return selectAgentsPaneRoute(
    useAgentsPaneNavigationStore.getState(),
    workspaceId,
  );
}

describe("agents pane navigation store", () => {
  beforeEach(() => {
    useAgentsPaneNavigationStore.setState({ routesByWorkspaceId: {} });
  });

  it("defaults every workspace to overview", () => {
    expect(routeOf(WS_A)).toEqual({ kind: "overview" });
  });

  it("navigates overview -> cluster -> detail and back down the same path", () => {
    const state = useAgentsPaneNavigationStore.getState();
    state.openCluster(WS_A, "parent-1");
    expect(routeOf(WS_A)).toEqual({ kind: "cluster", parentDurableId: "parent-1" });

    state.openDetail(WS_A, "parent-1", "child-1");
    expect(routeOf(WS_A)).toEqual({
      kind: "detail",
      parentDurableId: "parent-1",
      childDurableId: "child-1",
    });

    state.back(WS_A);
    expect(routeOf(WS_A)).toEqual({ kind: "cluster", parentDurableId: "parent-1" });

    state.back(WS_A);
    expect(routeOf(WS_A)).toEqual({ kind: "overview" });

    state.back(WS_A); // overview is the floor
    expect(routeOf(WS_A)).toEqual({ kind: "overview" });
  });

  it("keeps route state isolated per workspace", () => {
    const state = useAgentsPaneNavigationStore.getState();
    state.openDetail(WS_A, "parent-1", "child-1");
    state.openCluster(WS_B, "parent-9");

    expect(routeOf(WS_A)).toEqual({
      kind: "detail",
      parentDurableId: "parent-1",
      childDurableId: "child-1",
    });
    expect(routeOf(WS_B)).toEqual({ kind: "cluster", parentDurableId: "parent-9" });

    state.reset(WS_A);
    expect(routeOf(WS_A)).toEqual({ kind: "overview" });
    // Resetting A must not disturb B.
    expect(routeOf(WS_B)).toEqual({ kind: "cluster", parentDurableId: "parent-9" });
  });

  it("openOverview returns an already-drilled workspace to overview", () => {
    const state = useAgentsPaneNavigationStore.getState();
    state.openCluster(WS_A, "parent-1");
    state.openOverview(WS_A);
    expect(routeOf(WS_A)).toEqual({ kind: "overview" });
  });

  it("has no dependency on the session stores (main-session independence)", () => {
    const storeDir = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(
      join(storeDir, "agents-pane-navigation-store.ts"),
      "utf8",
    );
    // Opening/repairing routes must never touch the active main session:
    // the module may import nothing beyond zustand itself.
    const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map(
      (m) => m[1],
    );
    expect(imports).toEqual(["zustand"]);
    expect(source).not.toMatch(/session-selection|session-directory|sessions\//);
  });

  describe("repair on external disappearance", () => {
    const parents = new Set(["parent-1"]);
    const children = new Map<string, ReadonlySet<string>>([
      ["parent-1", new Set(["child-1"])],
    ]);

    it("is a no-op while the route's targets still exist", () => {
      const route: AgentsPaneRoute = {
        kind: "detail",
        parentDurableId: "parent-1",
        childDurableId: "child-1",
      };
      expect(repairAgentsPaneRoute(route, parents, children)).toBe(route);
    });

    it("falls detail -> cluster when only the child disappears", () => {
      expect(
        repairAgentsPaneRoute(
          { kind: "detail", parentDurableId: "parent-1", childDurableId: "child-gone" },
          parents,
          children,
        ),
      ).toEqual({ kind: "cluster", parentDurableId: "parent-1" });
    });

    it("falls cluster and detail -> overview when the parent disappears", () => {
      expect(
        repairAgentsPaneRoute(
          { kind: "cluster", parentDurableId: "parent-gone" },
          parents,
          children,
        ),
      ).toEqual({ kind: "overview" });
      expect(
        repairAgentsPaneRoute(
          { kind: "detail", parentDurableId: "parent-gone", childDurableId: "child-1" },
          parents,
          children,
        ),
      ).toEqual({ kind: "overview" });
    });

    it("repairs only the targeted workspace through the store action", () => {
      const state = useAgentsPaneNavigationStore.getState();
      state.openDetail(WS_A, "parent-1", "child-gone");
      state.openDetail(WS_B, "parent-gone", "child-1");

      state.repair(WS_A, parents, children);
      expect(routeOf(WS_A)).toEqual({ kind: "cluster", parentDurableId: "parent-1" });
      // B untouched until its own repair runs.
      expect(routeOf(WS_B)).toEqual({
        kind: "detail",
        parentDurableId: "parent-gone",
        childDurableId: "child-1",
      });

      state.repair(WS_B, parents, children);
      expect(routeOf(WS_B)).toEqual({ kind: "overview" });
    });
  });
});
