import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentApiKey } from "@proliferate/cloud-sdk";
import { Search } from "#product/primitives/icons/core";
import { Button } from "#product/primitives/Button";
import { Input } from "#product/primitives/Input";
import { ModalShell } from "#product/primitives/patterns/ModalShell";
import { ProviderRow } from "#product/components/settings/panes/agents/harness/ProviderRow";
import { HARNESS_PANE_COPY } from "#product/copy/settings/harness-pane";
import {
  getProviderSecretEnvVar,
  PROVIDER_REGISTRY,
  type ProviderRegistryEntry,
} from "#product/config/harness-env-vars";

interface ProviderPickerModalProps {
  open: boolean;
  onClose: () => void;
  /**
   * Confirming a provider's inline paste field. Exactly two writes follow
   * (agent-auth.md §5): a vault `api_key` entry, and one opencode selection row
   * whose env_var_name is the provider's key-shaped registry env var and whose
   * provider_hint is the provider id.
   */
  onSubmit: (provider: ProviderRegistryEntry, apiKeyValue: string) => void;
  /** Unbinds a configured provider's selection row. */
  onRemove: (providerId: string, envVarName: string | null) => void;
  /** Provider hints already wired on this harness. */
  configuredProviderIds?: readonly string[];
  /**
   * env_var_name values already bound on this harness — a provider whose
   * secret env var appears here renders as configured (green dot + Remove +
   * Replace) rather than as a fresh add.
   */
  boundEnvVarNames?: readonly string[];
  /** Vault keys by id, for the configured rows' redacted hints. */
  keysById?: ReadonlyMap<string, AgentApiKey>;
  /** Bound selection rows' key ids by env var, to resolve the hint. */
  rowKeyIdsByEnvVar?: ReadonlyMap<string, string>;
  submitting?: boolean;
  /** Failure of the two-write flow, rendered inline so the user can retry. */
  error?: string | null;
}

/**
 * The popular tier, shown by default. Ids are registry ids
 * (provider-registry.generated.json); anything not present in the vendored
 * registry simply never renders, so this list is safe to keep static across
 * vendoring refreshes.
 */
export const FEATURED_PROVIDER_IDS: readonly string[] = [
  "anthropic",
  "openai",
  "google",
  "google-vertex",
  "xai",
  "openrouter",
  "mistral",
  "deepseek",
  "groq",
  "azure",
  "amazon-bedrock",
  "opencode",
];

/**
 * Eligible for the single-secret picker: the provider has an env var that is
 * both server-valid and key-shaped (see getProviderSecretEnvVar). Providers
 * without one (302ai's digit-leading name, google-vertex's project/credentials
 * triple) are omitted — there is no var a pasted key could legally go into.
 */
function hasSecretEnvVar(provider: ProviderRegistryEntry): boolean {
  return getProviderSecretEnvVar(provider) !== null;
}

function matchesQuery(provider: ProviderRegistryEntry, query: string): boolean {
  if (!query) {
    return true;
  }
  return (
    provider.displayName.toLowerCase().includes(query)
    || provider.id.toLowerCase().includes(query)
  );
}

/**
 * OpenCode's provider MANAGEMENT surface (design-handoff v2 §3): one searchable
 * accordion list over the vendored provider registry where every row —
 * configured or not — expands to a key form. A configured row additionally
 * shows its wired state (`ENV_VAR · redacted` mono hint, per the handoff — the
 * one place an env var is shown, read-only) and a Remove action; its input
 * placeholder reads Replace. One row expands at a time; expanding resets the
 * key draft. Footer discloses the full registry count behind the featured tier.
 *
 * Lazily loaded by its caller: this module pulls in the vendored logo URL map,
 * which must not land in the login-path chunk.
 */
export function ProviderPickerModal({
  open,
  onClose,
  onSubmit,
  onRemove,
  configuredProviderIds = [],
  boundEnvVarNames = [],
  keysById,
  rowKeyIdsByEnvVar,
  submitting = false,
  error = null,
}: ProviderPickerModalProps) {
  const [search, setSearch] = useState("");
  const [expandedAll, setExpandedAll] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [secret, setSecret] = useState("");
  // Collapse the expanded row only once its in-flight save has SUCCEEDED —
  // submitting fell back to false with no error. Collapsing eagerly on submit
  // would orphan the inline failure message (the error renders inside the
  // expanded row) and make a rejected save look like a silent no-op.
  const wasSubmittingRef = useRef(false);
  useEffect(() => {
    if (wasSubmittingRef.current && !submitting && error === null) {
      setExpandedId(null);
    }
    wasSubmittingRef.current = submitting;
  }, [submitting, error]);

  // Each opening of the modal starts from the collapsed, unsearched state.
  useEffect(() => {
    if (!open) {
      return;
    }
    setSearch("");
    setExpandedAll(false);
    setExpandedId(null);
    setSecret("");
  }, [open]);

  const query = search.trim().toLowerCase();
  const searching = query.length > 0;

  const bound = useMemo(() => new Set(boundEnvVarNames), [boundEnvVarNames]);
  const configured = useMemo(
    () => new Set(configuredProviderIds),
    [configuredProviderIds],
  );

  const eligible = useMemo(() => PROVIDER_REGISTRY.filter(hasSecretEnvVar), []);

  const { visible, totalCount } = useMemo(() => {
    // Search always spans the full list, never just the featured tier.
    const matched = eligible.filter((provider) => matchesQuery(provider, query));
    if (searching || expandedAll) {
      return { visible: matched, totalCount: eligible.length };
    }
    const featured = matched.filter(
      (provider) =>
        FEATURED_PROVIDER_IDS.includes(provider.id)
        || configured.has(provider.id)
        // A provider whose secret var is already bound IS configured, even when
        // the row carries no provider_hint (hand-typed rows don't).
        || bound.has(getProviderSecretEnvVar(provider) ?? ""),
    );
    return { visible: featured, totalCount: eligible.length };
  }, [bound, configured, eligible, expandedAll, query, searching]);

  function isConfigured(provider: ProviderRegistryEntry): boolean {
    return (
      configured.has(provider.id)
      || bound.has(getProviderSecretEnvVar(provider) ?? "")
    );
  }

  function redactedHintFor(provider: ProviderRegistryEntry): string | null {
    const envVarName = getProviderSecretEnvVar(provider);
    if (envVarName === null) return null;
    const keyId = rowKeyIdsByEnvVar?.get(envVarName);
    const hint = keyId ? keysById?.get(keyId)?.redactedHint : undefined;
    return hint ?? null;
  }

  function handleConfirm(provider: ProviderRegistryEntry) {
    const value = secret.trim();
    const envVarName = getProviderSecretEnvVar(provider);
    if (value.length === 0 || submitting || envVarName === null) {
      return;
    }
    // Replace is handled downstream in ONE selection PUT: addBoundApiKey swaps
    // any existing row on the same env var for the new one (the server keys a
    // selection scope by (source_kind, env_var_name) and rejects duplicates,
    // so a separate remove-then-add pair would race and always collide).
    onSubmit(provider, value);
    setSecret("");
    // The row stays expanded until the two-write flow reports back: on success
    // the effect above collapses it (the row now shows its configured state);
    // on failure the error renders inline — a collapsed row would have nowhere
    // to show it.
  }

  return (
    // The sizeClassName/panelClassName overrides and the h-[34px]/max-h-
    // [340px] brackets below are deferred (frozen spec §4.3): fixing them
    // properly means a ModalShell size variant, which is a library edit out
    // of this slice's scope. Kept pixel-identical rather than rounded to the
    // nearest step.
    <ModalShell
      open={open}
      onClose={onClose}
      title={HARNESS_PANE_COPY.providersModalTitle}
      description={HARNESS_PANE_COPY.providersModalDescription}
      bodyClassName="px-5 pb-4 pt-2"
      panelClassName="border-border bg-card shadow-modal rounded-2xl"
      sizeClassName="max-w-[440px]"
    >
      <div className="flex flex-col gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 icon-paired -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search providers"
            placeholder="Search providers..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-[34px] pl-8"
            autoFocus
          />
        </div>
        <div className="max-h-[340px] overflow-y-auto rounded-lg border border-border">
          {visible.length === 0 ? (
            <p className="px-3 py-6 text-center text-ui-sm text-muted-foreground">
              No providers match your search.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {visible.map((provider) => (
                <ProviderRow
                  key={provider.id}
                  provider={provider}
                  expanded={expandedId === provider.id}
                  configured={isConfigured(provider)}
                  redactedHint={redactedHintFor(provider)}
                  secret={expandedId === provider.id ? secret : ""}
                  submitting={submitting}
                  error={expandedId === provider.id ? error : null}
                  onToggle={() => {
                    // One accordion at a time; expanding a row resets the draft
                    // so one provider's key is never prefilled into another.
                    if (expandedId === provider.id) {
                      setExpandedId(null);
                      return;
                    }
                    setExpandedId(provider.id);
                    setSecret("");
                  }}
                  onSecretChange={setSecret}
                  onConfirm={() => handleConfirm(provider)}
                  onRemove={() => {
                    onRemove(provider.id, getProviderSecretEnvVar(provider));
                    setExpandedId(null);
                  }}
                />
              ))}
            </ul>
          )}
        </div>
        {!searching ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full justify-center border-t border-border"
            onClick={() => setExpandedAll((previous) => !previous)}
          >
            {expandedAll
              ? "Show featured providers"
              : HARNESS_PANE_COPY.providersModalViewAll(totalCount)}
          </Button>
        ) : null}
      </div>
    </ModalShell>
  );
}
