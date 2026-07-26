// Typed provider-config field specs (Track D UI, D2/#agents-impl-plan.md §4).
//
// agent-auth.md's vault table ("The vault") says a typed vault entry's shape
// comes from its KIND alone, never from the harness that will end up using
// it — "the shape comes from the vault entry's kind" (not the harness). So
// one field-spec per `ProviderConfigKind` covers every harness that declares
// support for it; a harness's own render recipe (Rust, D3) is what maps
// these same named fields onto ITS OWN env vars (e.g. claude's Foundry vs.
// codex's Azure OpenAI provider block both consume the same azure_openai
// fields, differently).
//
// SEAM (read this before touching D1/D3): `getSupportedProviderConfigKinds`
// is the ONLY place that names which harness supports which kind, and it is
// hardcoded to `[]` for every harness today because the source of truth —
// registry.json `providerConfig` declarations — does not exist until D1
// lands (agents-impl-plan.md §4 D1). Once D1 ships, replace this function's
// body with a read of the harness's registry entry; nothing else in this
// file, `ProviderConfigCreatorModal`, or its call site needs to change. That
// is the one-file change the wiring PR (D3) gets to make.

export type ProviderConfigKind = "aws_bedrock" | "azure_openai";

export interface ProviderConfigFieldSpec {
  /** Machine key; becomes a property of the submitted `value` map. */
  key: string;
  label: string;
  placeholder?: string;
  helpText?: string;
  /** Masked input (type="password", telemetry-blocked), like a bare API key. */
  secret: boolean;
  required: boolean;
}

export interface ProviderConfigSpec {
  kind: ProviderConfigKind;
  displayName: string;
  description?: string;
  fields: readonly ProviderConfigFieldSpec[];
}

// Mirrors agent-auth.md's vault kind table exactly:
//   aws_bedrock   -> "a JSON document: region + credentials"
//   azure_openai  -> "a JSON document: endpoint, deployment, key"
//
// aws_bedrock is scoped to the bearer-token credential shape only
// (AWS_BEARER_TOKEN_BEDROCK + AWS_REGION — the pair already referenced by
// render.rs's sanitize_claude_ambient and catalog_probe.rs's
// CREDENTIAL_ENV_VARS). The spec text also allows a static access-key pair
// or an assumed role; D1 decides the final vault JSON shape, and this file
// is the seam that absorbs that decision without touching the modal.
const PROVIDER_CONFIG_SPECS: Readonly<Record<ProviderConfigKind, ProviderConfigSpec>> = {
  aws_bedrock: {
    kind: "aws_bedrock",
    displayName: "AWS Bedrock",
    description: "Use your own AWS Bedrock account.",
    fields: [
      {
        key: "region",
        label: "AWS region",
        placeholder: "us-east-1",
        secret: false,
        required: true,
      },
      {
        key: "bearerToken",
        label: "Bedrock bearer token",
        placeholder: "sk-...",
        helpText: "The Bedrock API key used as a bearer token (AWS_BEARER_TOKEN_BEDROCK).",
        secret: true,
        required: true,
      },
    ],
  },
  azure_openai: {
    kind: "azure_openai",
    displayName: "Azure OpenAI",
    description: "Use your own Azure OpenAI (or Azure AI Foundry) resource.",
    fields: [
      {
        key: "endpoint",
        label: "Resource endpoint",
        placeholder: "https://my-resource.openai.azure.com",
        secret: false,
        required: true,
      },
      {
        key: "deployment",
        label: "Deployment name",
        placeholder: "gpt-4o",
        secret: false,
        required: true,
      },
      {
        key: "apiKey",
        label: "API key",
        placeholder: "",
        secret: true,
        required: true,
      },
    ],
  },
};

/** The one function per SCOPE: given a kind, its field spec. Never null — the map is exhaustive over the type. */
export function getProviderConfigFieldSpec(kind: ProviderConfigKind): ProviderConfigSpec {
  return PROVIDER_CONFIG_SPECS[kind];
}

/**
 * Which typed provider-config kinds a harness offers on the UI today.
 *
 * HARDCODED TO EMPTY FOR EVERY HARNESS. R9's full Track D scope is claude x
 * {azure(Foundry), bedrock}, codex x {azure, bedrock}, opencode x {azure,
 * bedrock} — but that vocabulary lives in registry.json `providerConfig`
 * declarations that D1 has not landed yet, and the server has no `kind`
 * column to persist a typed entry against. Returning any kind here before
 * then would offer creating a secret the server cannot store or launch on —
 * exactly what the UI must not do. D3 replaces the body with a read of the
 * harness's registry entry; see the module comment.
 */
export function getSupportedProviderConfigKinds(
  _harnessKind: string,
): readonly ProviderConfigKind[] {
  return [];
}
