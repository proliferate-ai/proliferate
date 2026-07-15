import type { AgentAuthSelection } from "@proliferate/cloud-sdk";
import { describe, expect, it } from "vitest";
import {
  buildDesiredSources,
  deriveEditorState,
  isMultiSourceHarness,
  isNativeState,
  isRowComplete,
  isValidEnvVarName,
  type EditableApiKeyRow,
} from "./harness-auth-sources";

function selection(
  overrides: Partial<AgentAuthSelection> = {},
): AgentAuthSelection {
  return {
    id: "sel-1",
    harnessKind: "claude",
    surface: "local",
    sourceKind: "api_key",
    apiKeyId: "key-1",
    keyTitle: "Work key",
    envVarName: "ANTHROPIC_API_KEY",
    providerHint: "anthropic",
    enabled: true,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    ...overrides,
  } as AgentAuthSelection;
}

function row(overrides: Partial<EditableApiKeyRow> = {}): EditableApiKeyRow {
  return {
    uid: "row-1",
    envVarName: "ANTHROPIC_API_KEY",
    apiKeyId: "key-1",
    providerHint: "anthropic",
    enabled: true,
    ...overrides,
  };
}

describe("isValidEnvVarName", () => {
  it("accepts screaming snake case starting with a letter", () => {
    expect(isValidEnvVarName("ANTHROPIC_API_KEY")).toBe(true);
    expect(isValidEnvVarName("X")).toBe(true);
  });

  it("rejects lowercase, leading digits, and empty names", () => {
    expect(isValidEnvVarName("anthropic_api_key")).toBe(false);
    expect(isValidEnvVarName("1KEY")).toBe(false);
    expect(isValidEnvVarName("")).toBe(false);
    expect(isValidEnvVarName("HAS SPACE")).toBe(false);
  });
});

describe("isMultiSourceHarness", () => {
  it("is true only for opencode", () => {
    expect(isMultiSourceHarness("opencode")).toBe(true);
    expect(isMultiSourceHarness("claude")).toBe(false);
    expect(isMultiSourceHarness("codex")).toBe(false);
  });
});

describe("isRowComplete", () => {
  it("requires both a key and a valid env var name", () => {
    expect(isRowComplete(row())).toBe(true);
    expect(isRowComplete(row({ apiKeyId: null }))).toBe(false);
    expect(isRowComplete(row({ envVarName: "" }))).toBe(false);
    expect(isRowComplete(row({ envVarName: "bad name" }))).toBe(false);
  });
});

describe("deriveEditorState", () => {
  it("splits gateway and api_key rows for the scope", () => {
    const state = deriveEditorState(
      [
        selection({ id: "g", sourceKind: "gateway", apiKeyId: null, envVarName: null, keyTitle: null, providerHint: null }),
        selection({ id: "k", envVarName: "OPENROUTER_API_KEY", enabled: false }),
        selection({ id: "other", surface: "cloud" }),
        selection({ id: "elsewhere", harnessKind: "codex" }),
      ],
      "claude",
      "local",
    );

    expect(state.gatewayEnabled).toBe(true);
    expect(state.rows).toEqual([
      {
        uid: "k",
        envVarName: "OPENROUTER_API_KEY",
        apiKeyId: "key-1",
        providerHint: "anthropic",
        enabled: false,
      },
    ]);
  });

  it("treats a disabled gateway row as gateway-off", () => {
    const state = deriveEditorState(
      [selection({ id: "g", sourceKind: "gateway", apiKeyId: null, envVarName: null, keyTitle: null, providerHint: null, enabled: false })],
      "claude",
      "local",
    );
    expect(state.gatewayEnabled).toBe(false);
    expect(state.rows).toEqual([]);
  });
});

describe("buildDesiredSources", () => {
  it("emits an enabled gateway source when the toggle is on", () => {
    expect(
      buildDesiredSources({ gatewayEnabled: true, rows: [] }),
    ).toEqual([{ sourceKind: "gateway", enabled: true }]);
  });

  it("wires only complete rows and carries enabled/providerHint through", () => {
    const sources = buildDesiredSources({
      gatewayEnabled: false,
      rows: [
        row({ uid: "a", enabled: true }),
        row({ uid: "b", apiKeyId: null }), // incomplete → skipped
        row({ uid: "c", envVarName: "OPENAI_API_KEY", providerHint: null, enabled: false }),
      ],
    });

    expect(sources).toEqual([
      {
        sourceKind: "api_key",
        apiKeyId: "key-1",
        envVarName: "ANTHROPIC_API_KEY",
        providerHint: "anthropic",
        enabled: true,
      },
      {
        sourceKind: "api_key",
        apiKeyId: "key-1",
        envVarName: "OPENAI_API_KEY",
        providerHint: null,
        enabled: false,
      },
    ]);
  });
});

describe("isNativeState", () => {
  it("is native when nothing is enabled", () => {
    expect(isNativeState({ gatewayEnabled: false, rows: [] })).toBe(true);
    expect(
      isNativeState({ gatewayEnabled: false, rows: [row({ enabled: false })] }),
    ).toBe(true);
  });

  it("is not native when the gateway or any row is enabled", () => {
    expect(isNativeState({ gatewayEnabled: true, rows: [] })).toBe(false);
    expect(
      isNativeState({ gatewayEnabled: false, rows: [row({ enabled: true })] }),
    ).toBe(false);
  });
});
