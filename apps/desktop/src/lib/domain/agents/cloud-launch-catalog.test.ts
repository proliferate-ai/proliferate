import { describe, expect, it } from "vitest";
import {
  buildDesktopLaunchModelRegistries,
  mergeRuntimeLaunchOptionsIntoDesktopLaunchAgents,
  projectCloudAgentCatalogToDesktopLaunchCatalog,
} from "@/lib/domain/agents/cloud-launch-catalog";

function cloudCatalog(): Parameters<typeof projectCloudAgentCatalogToDesktopLaunchCatalog>[0] {
  return {
    schemaVersion: 2,
    catalogVersion: "2026-06-10.1",
    generatedAt: "2026-06-10T00:00:00Z",
    agents: [{
      kind: "opencode",
      displayName: "OpenCode",
      authContexts: [
        { id: "opencode-zen" },
        { id: "baseline" },
      ],
      session: {
        controls: [
          {
            key: "model",
            mapping: {
              createField: "modelId",
              switchVia: "configOption",
              liveConfigId: "model",
            },
          },
          {
            key: "mode",
            values: ["build", "plan"],
            mapping: { createField: "modeId", liveConfigId: "mode" },
          },
          {
            // No mapping: a probe-observed matrix dimension with no
            // application path must NOT project as a launch control.
            key: "effort",
            values: ["medium", "high"],
          },
        ],
        models: [
          {
            id: "opencode/big-pickle",
            displayName: "OpenCode Zen/Big Pickle",
            availability: { anyOf: ["opencode-zen"] },
            defaultVisible: true,
            controls: {
              effort: {
                values: ["medium", "high"],
                observedValue: "medium",
              },
            },
            status: "active",
          },
          {
            id: "opencode/hidden",
            displayName: "Hidden",
            availability: { anyOf: ["opencode-zen"] },
            defaultVisible: true,
            status: "hidden",
          },
          {
            id: "opencode/extra",
            displayName: "Extra",
            availability: { anyOf: ["opencode-zen"] },
            defaultVisible: false,
            status: "active",
          },
          {
            id: "opencode/deprecated",
            displayName: "Deprecated",
            availability: { anyOf: ["opencode-zen"] },
            defaultVisible: true,
            status: "deprecated",
          },
        ],
        defaults: { "opencode-zen": "opencode/big-pickle" },
      },
    }],
  };
}

describe("projectCloudAgentCatalogToDesktopLaunchCatalog", () => {
  it("projects controls, menu models, and defaults into desktop launch types", () => {
    const projected = projectCloudAgentCatalogToDesktopLaunchCatalog(
      cloudCatalog(),
      { workspaceId: "workspace-1" },
    );

    expect(projected).toMatchObject({
      schemaVersion: 2,
      catalogVersion: "2026-06-10.1",
      workspaceId: "workspace-1",
      agents: [{
        kind: "opencode",
        displayName: "OpenCode",
        defaultModelId: "opencode/big-pickle",
      }],
    });
    // The menu: defaultVisible && status === "active" only.
    expect(projected.agents[0]?.models.map((model) => model.id)).toEqual([
      "opencode/big-pickle",
    ]);
    expect(projected.agents[0]?.models[0]?.availability).toEqual({
      anyOf: ["opencode-zen"],
    });
    expect(projected.agents[0]?.launchControls.find((control) => control.key === "model"))
      .toBeUndefined();
    expect(projected.agents[0]?.launchControls.find((control) => control.key === "mode")
      ?.values).toEqual([
        {
          value: "build",
          label: "Build",
          description: null,
          isDefault: false,
          status: null,
        },
        {
          value: "plan",
          label: "Plan",
          description: null,
          isDefault: false,
          status: null,
        },
      ]);
    expect(projected.agents[0]?.launchControls.find((control) => control.key === "mode")
      ?.createField).toBe("modeId");
  });

  it("falls back to the first menu model when session defaults are absent", () => {
    const base = cloudCatalog();
    const baseAgent = base.agents[0]!;
    const projected = projectCloudAgentCatalogToDesktopLaunchCatalog({
      ...base,
      agents: [{
        ...baseAgent,
        session: { ...baseAgent.session, defaults: {} },
      }],
    });

    expect(projected.agents[0]?.defaultModelId).toBe("opencode/big-pickle");
    expect(projected.agents[0]?.models[0]?.isDefault).toBe(true);
  });

  it("keeps session default control metadata available for post-create live defaults", () => {
    const projected = projectCloudAgentCatalogToDesktopLaunchCatalog(cloudCatalog());
    const registries = buildDesktopLaunchModelRegistries(projected.agents);

    expect(registries[0]?.models[0]?.sessionDefaultControls).toEqual([{
      key: "effort",
      label: "Effort",
      defaultValue: "medium",
      values: [
        {
          value: "medium",
          label: "Medium",
          description: null,
          isDefault: true,
        },
        {
          value: "high",
          label: "High",
          description: null,
          isDefault: false,
        },
      ],
    }]);
  });
});

describe("mergeRuntimeLaunchOptionsIntoDesktopLaunchAgents", () => {
  it("preserves curated catalog metadata when runtime ids match catalog aliases", () => {
    const base = cloudCatalog();
    const baseAgent = base.agents[0]!;
    const projected = projectCloudAgentCatalogToDesktopLaunchCatalog({
      ...base,
      agents: [{
        ...baseAgent,
        session: {
          ...baseAgent.session,
          defaults: { "opencode-zen": "sonnet" },
          models: [{
            id: "sonnet",
            displayName: "Sonnet",
            description: "Curated description",
            aliases: ["us.anthropic.claude-sonnet-4-6"],
            availability: { anyOf: ["opencode-zen"] },
            defaultVisible: true,
            status: "active",
          }],
        },
      }],
    });

    const merged = mergeRuntimeLaunchOptionsIntoDesktopLaunchAgents(
      projected.agents,
      [{
        kind: "opencode",
        displayName: "OpenCode",
        defaultModelId: "us.anthropic.claude-sonnet-4-6",
        models: [{
          id: "us.anthropic.claude-sonnet-4-6",
          displayName: "Claude Sonnet 4.6",
          isDefault: true,
          defaultOptIn: null,
        }],
      }],
    );

    expect(merged[0]?.models[0]).toMatchObject({
      id: "us.anthropic.claude-sonnet-4-6",
      displayName: "Claude Sonnet 4.6",
      description: "Curated description",
      aliases: ["sonnet"],
      isDefault: true,
      availability: { anyOf: ["opencode-zen"] },
    });
  });

  it("uses curated catalog labels when runtime models report their id as the label", () => {
    const base = cloudCatalog();
    const baseAgent = base.agents[0]!;
    const projected = projectCloudAgentCatalogToDesktopLaunchCatalog({
      ...base,
      agents: [{
        ...baseAgent,
        kind: "cursor",
        displayName: "Cursor",
        session: {
          ...baseAgent.session,
          defaults: {},
          models: [{
            id: "composer-2.5",
            displayName: "Composer 2.5",
            availability: { anyOf: ["cursor-login"] },
            defaultVisible: true,
            status: "active",
          }],
        },
      }],
    });

    const merged = mergeRuntimeLaunchOptionsIntoDesktopLaunchAgents(
      projected.agents,
      [{
        kind: "cursor",
        displayName: "Cursor",
        defaultModelId: "composer-2.5",
        models: [{
          id: "composer-2.5",
          displayName: "composer-2.5",
          isDefault: true,
          defaultOptIn: null,
        }],
      }],
    );

    expect(merged[0]?.models[0]).toMatchObject({
      id: "composer-2.5",
      displayName: "Composer 2.5",
    });
  });

  it("matches config-shaped runtime ids to canonical catalog models", () => {
    const base = cloudCatalog();
    const baseAgent = base.agents[0]!;
    const projected = projectCloudAgentCatalogToDesktopLaunchCatalog({
      ...base,
      agents: [{
        ...baseAgent,
        kind: "cursor",
        displayName: "Cursor",
        session: {
          ...baseAgent.session,
          defaults: {},
          models: [{
            id: "composer-2.5-fast",
            displayName: "Composer 2.5 Fast",
            aliases: ["composer-2[fast=true]"],
            availability: { anyOf: ["cursor-login"] },
            defaultVisible: true,
            status: "active",
          }],
        },
      }],
    });

    const merged = mergeRuntimeLaunchOptionsIntoDesktopLaunchAgents(
      projected.agents,
      [{
        kind: "cursor",
        displayName: "Cursor",
        defaultModelId: "composer-2.5[fast=true]",
        models: [{
          id: "composer-2.5[fast=true]",
          displayName: "composer-2.5",
          isDefault: true,
          defaultOptIn: null,
        }],
      }],
    );

    expect(merged[0]?.models[0]).toMatchObject({
      id: "composer-2.5[fast=true]",
      displayName: "Composer 2.5 Fast",
      aliases: ["composer-2.5-fast", "composer-2[fast=true]"],
    });
  });

  it("drops gated catalog-only models when active auth contexts are known", () => {
    const projected = projectCloudAgentCatalogToDesktopLaunchCatalog(cloudCatalog());

    const withoutContexts = mergeRuntimeLaunchOptionsIntoDesktopLaunchAgents(
      projected.agents,
      null,
    );
    expect(withoutContexts[0]?.models.map((model) => model.id)).toEqual([
      "opencode/big-pickle",
    ]);

    const gated = mergeRuntimeLaunchOptionsIntoDesktopLaunchAgents(
      projected.agents,
      null,
      { activeAuthContextIds: ["baseline"] },
    );
    expect(gated[0]?.models).toEqual([]);

    const enabled = mergeRuntimeLaunchOptionsIntoDesktopLaunchAgents(
      projected.agents,
      null,
      { activeAuthContextIds: ["opencode-zen"] },
    );
    expect(enabled[0]?.models.map((model) => model.id)).toEqual([
      "opencode/big-pickle",
    ]);
  });
});
