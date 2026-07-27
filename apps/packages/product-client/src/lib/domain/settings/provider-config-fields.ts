// Typed provider-config field specs (Track D UI).
//
// agent-auth.md's vault table ("The vault") says a typed vault entry's shape
// comes from its KIND alone, never from the harness that will end up using
// it — "the shape comes from the vault entry's kind" (not the harness). So
// one field-spec per `ProviderConfigKind` covers every harness that declares
// support for it; a harness's own render recipe (Rust) is what maps these
// same named fields onto ITS OWN env vars.
//
// `getSupportedProviderConfigKinds` reads the bundled registry.json
// `providerConfig` declarations — the ONE source of truth for which harness
// supports which kind (the server's write gate reads the same document via
// `supported_provider_config_kinds`, server/proliferate/server/catalogs/
// service.py). A declaration flagged `pending` is excluded on both sides:
// pending means "vocabulary declared, launch-time application unverified"
// (today: codex x azure_openai and claude x azure_openai/Foundry, each
// awaiting its Gate 4 live run), and the UI must never offer creating a
// selection the write gate will refuse.

// Package-relative copy emitted by scripts/copy-product-client-assets.mjs from
// the repo-root catalogs/agents/registry.json (gitignored; no checked-in
// duplicate) — same mechanism as bundled-agent-catalog.ts.
import bundledAgentRegistryJson from "../../../generated/agent-registry.json?raw";

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

// Mirrors agent-auth.md's vault kind table:
//   aws_bedrock   -> "a JSON document: region + credentials"
//   azure_openai  -> "a JSON document: endpoint + key"
//
// aws_bedrock is scoped to the bearer-token credential shape only
// (AWS_BEARER_TOKEN_BEDROCK + AWS_REGION — the pair already referenced by
// render.rs's sanitize_claude_ambient and catalog_probe.rs's
// CREDENTIAL_ENV_VARS).
//
// azure_openai collects endpoint + apiKey ONLY (founder ruling R5): the
// `deployment` field was DROPPED — the server renderer deliberately never
// translated it into any harness's env set
// (materialize/agent_auth.py `_translate_provider_config_env`), so
// collecting it stored a value nothing would ever read. The server's
// create validation enforces the same field set.
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
        key: "apiKey",
        label: "API key",
        placeholder: "",
        secret: true,
        required: true,
      },
    ],
  },
};

const KNOWN_KINDS: readonly ProviderConfigKind[] = ["aws_bedrock", "azure_openai"];

interface RegistryProviderConfigEntry {
  kind?: unknown;
  pending?: unknown;
}

interface RegistryAgent {
  kind?: unknown;
  providerConfig?: unknown;
}

function parseSupportedKindsByHarness(
  rawRegistry: string,
): ReadonlyMap<string, readonly ProviderConfigKind[]> {
  const supported = new Map<string, readonly ProviderConfigKind[]>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawRegistry);
  } catch {
    return supported;
  }
  const agents = (parsed as { agents?: unknown } | null)?.agents;
  if (!Array.isArray(agents)) return supported;
  for (const agent of agents as RegistryAgent[]) {
    if (typeof agent?.kind !== "string") continue;
    const declarations = agent.providerConfig;
    if (!Array.isArray(declarations)) continue;
    const kinds = declarations
      .filter(
        (entry: RegistryProviderConfigEntry): entry is RegistryProviderConfigEntry =>
          typeof entry?.kind === "string" &&
          entry.pending !== true &&
          (KNOWN_KINDS as readonly string[]).includes(entry.kind as string),
      )
      .map((entry) => entry.kind as ProviderConfigKind)
      // Sorted to match the server's deterministic ordering
      // (supported_provider_config_kinds sorts too).
      .sort();
    supported.set(agent.kind, kinds);
  }
  return supported;
}

const SUPPORTED_KINDS_BY_HARNESS = parseSupportedKindsByHarness(bundledAgentRegistryJson);

/** The one function per SCOPE: given a kind, its field spec. Never null — the map is exhaustive over the type. */
export function getProviderConfigFieldSpec(kind: ProviderConfigKind): ProviderConfigSpec {
  return PROVIDER_CONFIG_SPECS[kind];
}

/**
 * Which typed provider-config kinds a harness offers on the UI: the
 * harness's registry `providerConfig` declarations minus any flagged
 * `pending` — exactly the set the server's selection write gate admits, so
 * the UI never offers creating a config the server would refuse to wire.
 * Empty for a harness with no declarations (cursor, grok) or an unknown one.
 */
export function getSupportedProviderConfigKinds(
  harnessKind: string,
): readonly ProviderConfigKind[] {
  return SUPPORTED_KINDS_BY_HARNESS.get(harnessKind) ?? [];
}
