import { describe, expect, it } from "vitest";
import {
  getProviderConfigFieldSpec,
  getSupportedProviderConfigKinds,
  type ProviderConfigKind,
} from "#product/lib/domain/settings/provider-config-fields";

const KINDS: readonly ProviderConfigKind[] = ["aws_bedrock", "azure_openai"];

describe("getProviderConfigFieldSpec", () => {
  it("returns a spec for every known kind with at least one required field", () => {
    for (const kind of KINDS) {
      const spec = getProviderConfigFieldSpec(kind);
      expect(spec.kind).toBe(kind);
      expect(spec.displayName.length).toBeGreaterThan(0);
      expect(spec.fields.length).toBeGreaterThan(0);
      expect(spec.fields.some((field) => field.required)).toBe(true);
    }
  });

  it("aws_bedrock declares region (plain) + bearer token (secret) per the vault contract", () => {
    const spec = getProviderConfigFieldSpec("aws_bedrock");
    const keys = spec.fields.map((field) => field.key);
    expect(keys).toContain("region");
    expect(keys).toContain("bearerToken");

    const region = spec.fields.find((field) => field.key === "region");
    expect(region?.secret).toBe(false);
    const bearerToken = spec.fields.find((field) => field.key === "bearerToken");
    expect(bearerToken?.secret).toBe(true);
  });

  it("azure_openai declares endpoint (plain) + api key (secret) ONLY — deployment is dropped (R5)", () => {
    // Founder ruling R5: the azure_openai vault entry collects endpoint +
    // apiKey only. `deployment` is deliberately absent — the renderer never
    // translated it into any harness env set, and the server's create
    // validation rejects it as an unknown field.
    const spec = getProviderConfigFieldSpec("azure_openai");
    const keys = spec.fields.map((field) => field.key);
    expect(keys).toEqual(["endpoint", "apiKey"]);

    expect(spec.fields.find((field) => field.key === "endpoint")?.secret).toBe(false);
    expect(spec.fields.find((field) => field.key === "apiKey")?.secret).toBe(true);
  });
});

describe("getSupportedProviderConfigKinds", () => {
  it("mirrors the registry's non-pending providerConfig declarations per harness", () => {
    // The same combos the server's selection write gate admits
    // (supported_provider_config_kinds): registry declarations minus pending.
    expect(getSupportedProviderConfigKinds("claude")).toEqual(["aws_bedrock"]);
    expect(getSupportedProviderConfigKinds("codex")).toEqual(["aws_bedrock"]);
    expect(getSupportedProviderConfigKinds("opencode")).toEqual([
      "aws_bedrock",
      "azure_openai",
    ]);
  });

  it("keeps claude x azure_openai (Foundry) excluded while its declaration is pending", () => {
    // R5/R11 pin: the Foundry cell is declared but `pending` its Gate 4 live
    // verification, so the UI must not offer it until the registry flag
    // clears — this test fails the moment someone un-pends the declaration,
    // forcing a deliberate decision.
    expect(getSupportedProviderConfigKinds("claude")).not.toContain("azure_openai");
    expect(getSupportedProviderConfigKinds("codex")).not.toContain("azure_openai");
  });

  it("is empty for harnesses without providerConfig declarations", () => {
    for (const harnessKind of ["cursor", "grok", "not-a-real-harness"]) {
      expect(getSupportedProviderConfigKinds(harnessKind)).toEqual([]);
    }
  });
});
