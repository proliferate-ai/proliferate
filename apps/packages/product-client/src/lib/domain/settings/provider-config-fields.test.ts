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

  it("azure_openai declares endpoint + deployment (plain) + api key (secret) per the vault contract", () => {
    const spec = getProviderConfigFieldSpec("azure_openai");
    const keys = spec.fields.map((field) => field.key);
    expect(keys).toEqual(["endpoint", "deployment", "apiKey"]);

    expect(spec.fields.find((field) => field.key === "endpoint")?.secret).toBe(false);
    expect(spec.fields.find((field) => field.key === "deployment")?.secret).toBe(false);
    expect(spec.fields.find((field) => field.key === "apiKey")?.secret).toBe(true);
  });
});

describe("getSupportedProviderConfigKinds", () => {
  it("is empty for every harness until D1 lands the registry declarations", () => {
    for (const harnessKind of ["claude", "codex", "opencode", "cursor", "grok"]) {
      expect(getSupportedProviderConfigKinds(harnessKind)).toEqual([]);
    }
  });
});
