import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Search } from "@proliferate/ui/icons";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { ModalShell } from "@proliferate/ui/patterns/ModalShell";
import {
  getProviderSecretEnvVar,
  PROVIDER_REGISTRY,
  type ProviderRegistryEntry,
} from "#product/config/harness-env-vars";
import { PROVIDER_LOGO_URLS } from "#product/config/provider-logos.generated";

interface ProviderPickerModalProps {
  open: boolean;
  onClose: () => void;
  /**
   * Confirming a provider's inline paste field. Exactly two writes follow
   * (agent-auth.md §5): a vault `api_key` entry, and one opencode selection row
   * whose env_var_name is the provider's first registry env var and whose
   * provider_hint is the provider id.
   */
  onSubmit: (provider: ProviderRegistryEntry, apiKeyValue: string) => void;
  /** Provider hints already wired on this harness; always shown expanded. */
  configuredProviderIds?: readonly string[];
  /**
   * env_var_name values already bound on this harness. The server keys a
   * selection scope by (source_kind, env_var_name) and rejects a duplicate, so a
   * provider whose secret env var is already bound renders as configured rather
   * than offering an add that would 400 after the vault key was written.
   */
  boundEnvVarNames?: readonly string[];
  submitting?: boolean;
  /** Failure of the two-write flow, rendered inline so the user can retry. */
  error?: string | null;
}

/**
 * The popular tier, expanded by default. Ids are registry ids
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

/** Neutral fallback for a provider with no vendored (or no published) mark. */
function ProviderLogo({ provider }: { provider: ProviderRegistryEntry }) {
  const src = PROVIDER_LOGO_URLS[provider.id];
  if (src === undefined) {
    return (
      <span
        aria-hidden
        className="flex size-4 shrink-0 items-center justify-center rounded-sm border border-border text-ui-sm text-muted-foreground"
      >
        {provider.displayName.slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return <img src={src} alt="" aria-hidden className="size-4 shrink-0" />;
}

/**
 * Searchable list over the vendored provider registry (agent-auth.md §5),
 * styled like OpenCode/Conductor's own provider picker: a featured tier plus
 * every already-configured provider expanded by default, the remainder behind
 * "Show more providers", and per-row logos. Providers with no server-valid,
 * key-shaped env var are omitted (there is nowhere legal for a single pasted
 * secret to go — they belong to the typed provider-config path, §4). Selecting a
 * row expands it into an inline paste-first field; a provider whose secret env
 * var is already bound renders as configured, with no add path.
 *
 * Lazily loaded by its caller: this module pulls in the vendored logo URL map,
 * which must not land in the login-path chunk.
 */
export function ProviderPickerModal({
  open,
  onClose,
  onSubmit,
  configuredProviderIds = [],
  boundEnvVarNames = [],
  submitting = false,
  error = null,
}: ProviderPickerModalProps) {
  const [search, setSearch] = useState("");
  const [expandedAll, setExpandedAll] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [secret, setSecret] = useState("");
  // Which provider the current draft secret was typed for. Collapsing a row (or
  // a failed save) keeps the draft, so ownership has to be tracked separately
  // from `selectedId` — one provider's key must never be prefilled into another.
  const [secretOwnerId, setSecretOwnerId] = useState<string | null>(null);

  // Each opening of the modal starts from the collapsed, unsearched state.
  useEffect(() => {
    if (!open) {
      return;
    }
    setSearch("");
    setExpandedAll(false);
    setSelectedId(null);
    setSecret("");
    setSecretOwnerId(null);
  }, [open]);

  const query = search.trim().toLowerCase();
  const searching = query.length > 0;

  const bound = useMemo(() => new Set(boundEnvVarNames), [boundEnvVarNames]);

  const { visible, hiddenCount } = useMemo(() => {
    const configured = new Set(configuredProviderIds);
    const eligible = PROVIDER_REGISTRY.filter(hasSecretEnvVar);
    // Search always spans the full list, never just the featured tier.
    const matched = eligible.filter((provider) => matchesQuery(provider, query));
    if (searching || expandedAll) {
      return { visible: matched, hiddenCount: 0 };
    }
    const featured = matched.filter(
      (provider) =>
        FEATURED_PROVIDER_IDS.includes(provider.id)
        || configured.has(provider.id)
        // A provider whose secret var is already bound IS configured, even when
        // the row carries no provider_hint (hand-typed rows don't).
        || bound.has(getProviderSecretEnvVar(provider) ?? ""),
    );
    return { visible: featured, hiddenCount: matched.length - featured.length };
  }, [bound, configuredProviderIds, expandedAll, query, searching]);

  function handleConfirm(provider: ProviderRegistryEntry) {
    const value = secret.trim();
    const envVarName = getProviderSecretEnvVar(provider);
    // Guard the (source_kind, env_var_name) uniqueness the server enforces:
    // submitting here would create a vault key and then 400 ("Duplicate
    // selection source"), orphaning it. The row is already non-addable in the
    // UI; this is the belt-and-braces check on the write path.
    if (
      value.length === 0
      || submitting
      || envVarName === null
      || bound.has(envVarName)
    ) {
      return;
    }
    onSubmit(provider, value);
  }

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="Add provider"
      description="Pick a provider to wire one of your own keys into OpenCode."
      bodyClassName="px-5 pb-5 pt-2"
    >
      <div className="flex flex-col gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 icon-paired -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search providers"
            placeholder="Search providers..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-8"
            autoFocus
          />
        </div>
        <div className="max-h-80 overflow-y-auto rounded-md border border-border">
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
                  selected={selectedId === provider.id}
                  secret={secret}
                  submitting={submitting}
                  alreadyBound={bound.has(getProviderSecretEnvVar(provider) ?? "")}
                  error={selectedId === provider.id ? error : null}
                  onSelect={() => {
                    // Re-clicking the open row collapses it and KEEPS the typed
                    // draft, so a mis-click never wipes a pasted secret.
                    if (selectedId === provider.id) {
                      setSelectedId(null);
                      return;
                    }
                    setSelectedId(provider.id);
                    // Only clear when the draft belongs to a DIFFERENT provider.
                    if (secretOwnerId !== provider.id) {
                      setSecret("");
                      setSecretOwnerId(provider.id);
                    }
                  }}
                  onSecretChange={(value) => {
                    setSecret(value);
                    setSecretOwnerId(provider.id);
                  }}
                  onConfirm={() => handleConfirm(provider)}
                />
              ))}
            </ul>
          )}
        </div>
        {!searching && (hiddenCount > 0 || expandedAll) ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={() => setExpandedAll((previous) => !previous)}
          >
            {expandedAll
              ? "Show fewer providers"
              : `Show more providers (${hiddenCount})`}
          </Button>
        ) : null}
      </div>
    </ModalShell>
  );
}

function ProviderRow({
  provider,
  selected,
  secret,
  submitting,
  alreadyBound,
  error,
  onSelect,
  onSecretChange,
  onConfirm,
}: {
  provider: ProviderRegistryEntry;
  selected: boolean;
  secret: string;
  submitting: boolean;
  alreadyBound: boolean;
  error: string | null;
  onSelect: () => void;
  onSecretChange: (value: string) => void;
  onConfirm: () => void;
}) {
  // The var the secret lands in — never envVarNames[0], which is a resource
  // name / project id on multi-field providers.
  const envVarName = getProviderSecretEnvVar(provider) ?? "";
  if (alreadyBound) {
    // Configured already: show the wired state instead of an add path that the
    // server would reject as a duplicate (source_kind, env_var_name) scope.
    return (
      <li>
        <div className="flex min-h-7 w-full select-none items-center gap-1.5 px-2.5 py-[5px] text-ui-sm text-muted-foreground">
          <ProviderLogo provider={provider} />
          <span className="font-medium text-popover-foreground">
            {provider.displayName}
          </span>
          <span className="ml-auto flex items-center gap-1.5">
            <span className="font-mono">{envVarName}</span>
            <span>Configured</span>
          </span>
        </div>
      </li>
    );
  }
  return (
    <li>
      <button
        type="button"
        aria-expanded={selected}
        onClick={onSelect}
        className="flex min-h-7 w-full cursor-pointer select-none items-center gap-1.5 rounded-lg px-2.5 py-[5px] text-ui-sm text-popover-foreground outline-none transition-colors hover:bg-hover focus:bg-hover"
      >
        <ProviderLogo provider={provider} />
        <span className="font-medium">{provider.displayName}</span>
        <span className="ml-auto flex items-center gap-1.5 text-muted-foreground">
          <span className="font-mono">{envVarName}</span>
          <ChevronRight className="icon-paired" />
        </span>
      </button>
      {selected ? (
        <>
          <form
            className="flex items-center gap-1.5 px-2.5 pb-2"
            onSubmit={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            <Input
              aria-label={`${provider.displayName} API key`}
              placeholder={`Paste your ${provider.displayName} API key`}
              type="password"
              value={secret}
              onChange={(event) => onSecretChange(event.target.value)}
              autoFocus
            />
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={submitting || secret.trim().length === 0}
            >
              Save
            </Button>
          </form>
          {error === null ? null : (
            <p role="alert" className="px-2.5 pb-2 text-ui-sm text-destructive">
              {error}
            </p>
          )}
        </>
      ) : null}
    </li>
  );
}
