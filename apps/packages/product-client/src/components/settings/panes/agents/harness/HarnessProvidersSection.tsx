import { lazy, Suspense, useEffect, useState } from "react";
import { useCreateAgentApiKey, useRevokeAgentApiKey } from "@proliferate/cloud-sdk-react";
import { Button } from "#product/primitives/Button";
import { IconTile } from "#product/primitives/IconTile";
import { SettingsSection } from "#product/primitives/patterns/settings/SettingsSection";
import {
  getProviderSecretEnvVar,
  PROVIDER_REGISTRY,
  type ProviderRegistryEntry,
} from "#product/config/harness-env-vars";
import { HARNESS_PANE_COPY } from "#product/copy/settings/harness-pane";
import type { HarnessAuthEditorApi } from "#product/hooks/agents/workflows/use-harness-auth-editor";
import {
  deriveProvidersStatus,
  HarnessAuthStatusAction,
} from "#product/components/settings/panes/agents/harness/HarnessAuthStatusBadge";
import {
  HarnessAuthEvidenceBadge,
  HarnessAuthEvidenceSummary,
} from "#product/components/settings/panes/agents/harness/HarnessAuthEvidenceBadge";
import { isFeatureEnabled } from "#product/config/feature-flags";

// Lazy: the modal pulls in the vendored provider-logo asset map (170+ marks),
// which must never reach the login-path chunk (login JS budget gate,
// scripts/measure-login-runtime-budget.mjs).
const ProviderPickerModal = lazy(async () => ({
  default: (
    await import("#product/components/settings/panes/agents/harness/ProviderPickerModal")
  ).ProviderPickerModal,
}));

/**
 * OpenCode's providers-only section (design-handoff v2 §2): NO method chooser,
 * NO gateway. Header carries the one status badge + refresh; the body is a
 * summary row of overlapping provider icon tiles plus a Configure button that
 * opens the management modal. OpenCode's own CLI logins always apply alongside
 * these keys, so the quiet line says exactly that.
 */
export function HarnessProvidersSection({
  editor,
}: {
  editor: HarnessAuthEditorApi;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  // The Configure trigger, not the modal, is the Class B loading treatment
  // (UX Latency + Transitions ADR §4.3, Rung 3): the modal chunk carries the
  // 170+-mark provider-logo asset map, so opening it cold can outlive the
  // show-delay. Rather than let `Suspense fallback={null}` pop the modal in
  // blank once the chunk lands, the trigger button shows a Spinner while the
  // import resolves and only flips `modalOpen` once the modal can paint
  // immediately.
  const [modalLoading, setModalLoading] = useState(false);
  // The summary tiles show the real models.dev marks. The generated URL map is
  // dynamic-imported (same budget rule as the modal: it must never land in the
  // login-path chunk); until it resolves the tiles fall back to mono letters.
  const [logoUrls, setLogoUrls] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    let cancelled = false;
    void import("#product/config/provider-logos.generated").then((mod) => {
      if (!cancelled) setLogoUrls(mod.PROVIDER_LOGO_URLS);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const [providerError, setProviderError] = useState<string | null>(null);
  const createKey = useCreateAgentApiKey();
  const revokeKey = useRevokeAgentApiKey();

  const rows = editor.editorState.rows.filter((row) => row.apiKeyId !== null);
  // Resolve each bound row back to its registry provider (by hint, else by the
  // env var) so the summary tiles can show the provider's mark.
  const configured = rows
    .map((row) => ({
      row,
      provider:
        PROVIDER_REGISTRY.find((provider) => provider.id === row.providerHint)
        ?? PROVIDER_REGISTRY.find((provider) =>
          provider.envVarNames.includes(row.envVarName),
        )
        ?? null,
    }));

  // Qualification readback (tests/release chat-authroute.ts): opencode's
  // active routes as whitespace-separated `<kind>:<route>` tokens, matched
  // with the exact-token `~=` selector. CLI is always active (opencode's
  // native logins coexist); api_key joins when any bound row is enabled.
  const selectedRoute = rows.some((row) => row.enabled)
    ? "opencode:cli opencode:api_key"
    : "opencode:cli";

  const status = deriveProvidersStatus();
  const refreshing = editor.apiKeysQuery.isFetching || editor.selectionsQuery.isFetching;
  // Flag-ON (ADR agent-auth rung 6): opencode's badge reads the runtime's
  // derived authState, killing deriveProvidersStatus's unconditional green.
  const evidenceOn = isFeatureEnabled("agentAuthEvidencePanes");
  const authState = evidenceOn ? editor.localAgent?.authState ?? null : null;
  function handleRefresh() {
    void editor.apiKeysQuery.refetch();
    void editor.selectionsQuery.refetch();
  }

  // §5's two writes: a vault api_key entry, then one selection row whose
  // env_var_name is the provider's key-shaped registry env var and whose
  // provider_hint is the provider id (display-only). Not atomic: if the
  // selection PUT is rejected, the just-created vault key is revoked (nothing
  // references it) and the error renders inline — a failed save never leaves
  // an orphaned key or a row that looks wired.
  function handleProviderSubmit(provider: ProviderRegistryEntry, value: string) {
    const envVarName = getProviderSecretEnvVar(provider);
    if (envVarName === null) {
      // The modal filters these out; belt-and-braces so no secret is ever
      // written under a non-key env var.
      setProviderError(HARNESS_PANE_COPY.addApiKeyError);
      return;
    }
    setProviderError(null);
    createKey.mutate(
      { title: `${provider.displayName} API key`, value, kind: "api_key" },
      {
        onSuccess: (created) => {
          editor.addBoundApiKey(envVarName, provider.id, created.id, {
            onSuccess: () => setProviderError(null),
            onError: (message) => {
              setProviderError(message);
              revokeKey.mutate(created.id);
            },
          });
        },
        onError: (error) => {
          setProviderError(error.message || HARNESS_PANE_COPY.addApiKeyError);
        },
      },
    );
  }

  function handleProviderRemove(providerId: string, envVarName: string | null) {
    // Two-pass: an exact provider_hint match always wins; the env-var fallback
    // (hint-less legacy rows) only runs when no hinted row exists, so a shared
    // env var can never unbind a sibling provider's hinted row.
    const target =
      rows.find((row) => row.providerHint === providerId)
      ?? (envVarName === null
        ? undefined
        : rows.find((row) => row.envVarName === envVarName));
    if (!target) return;
    editor.handleRemoveRow(target.uid);
  }

  // Modal props precomputed outside the JSX: these are wiring maps over the
  // handful of bound selection rows, not a rendered list surface.
  const boundEnvVarNames = rows.map((row) => row.envVarName);
  const rowKeyIdsByEnvVar = new Map(
    rows
      .filter((row) => row.apiKeyId !== null)
      .map((row) => [row.envVarName, row.apiKeyId as string]),
  );

  return (
    <SettingsSection
      title={HARNESS_PANE_COPY.providersTitle}
      description={HARNESS_PANE_COPY.providersDescription}
      titleWeight="emphasized"
      surface="plain"
      action={authState ? (
        <HarnessAuthEvidenceBadge
          authState={authState}
          refreshing={refreshing}
          onRefresh={handleRefresh}
          data-harness-status="api_key"
        />
      ) : (
        <HarnessAuthStatusAction
          status={status}
          refreshing={refreshing}
          onRefresh={handleRefresh}
          data-harness-status="api_key"
        />
      )}
      data-harness-auth-section="opencode"
      data-harness-auth-delivery={editor.deliveryPending ? "pending" : "applied"}
      data-harness-selected-route={selectedRoute}
    >
      {authState ? <HarnessAuthEvidenceSummary authState={authState} /> : null}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          {configured.length > 0 ? (
            <div className="flex items-center">
              {configured.map(({ row, provider }, index) => {
                const logoSrc = provider ? logoUrls?.[provider.id] : undefined;
                return (
                  // Enumerated pixel delta: this stack was `size-7` (28px).
                  // `IconTile`'s size axis is the 24/32/40 step set evidenced
                  // across the tree, and 28px rounds up to `md` (32px) rather
                  // than adding a fourth step that would turn a variant set
                  // into a scale (see IconTile's own note). The `-ml-1.5`
                  // overlap is unchanged, so the fan reads the same, 4px wider
                  // per tile.
                  <IconTile
                    key={row.uid}
                    tone="outlined"
                    size="md"
                    aria-hidden
                    title={provider?.displayName ?? row.envVarName}
                    className={[
                      "font-mono text-ui-sm",
                      index > 0 ? "-ml-1.5" : "",
                      row.enabled ? "" : "opacity-60",
                    ].join(" ")}
                    data-api-key-saved={row.providerHint ?? undefined}
                  >
                    {logoSrc === undefined ? (
                      (provider?.displayName ?? row.envVarName).slice(0, 1).toUpperCase()
                    ) : (
                      // models.dev marks paint with currentColor (black in an
                      // <img>): flatten and invert to the mono treatment.
                      <img
                        src={logoSrc}
                        alt=""
                        className="size-4 brightness-0 invert-[0.78]"
                      />
                    )}
                  </IconTile>
                );
              })}
            </div>
          ) : null}
          <span className="text-ui text-muted-foreground">
            {configured.length > 0
              ? HARNESS_PANE_COPY.providersConfiguredCount(configured.length)
              : HARNESS_PANE_COPY.providersNone}
          </span>
        </div>

        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={editor.busy || modalLoading}
            loading={modalLoading}
            onClick={() => {
              setModalLoading(true);
              void import(
                "#product/components/settings/panes/agents/harness/ProviderPickerModal"
              )
                .then(() => {
                  setModalLoading(false);
                  setModalOpen(true);
                })
                .catch(() => {
                  // A rejected chunk import (offline, bad deploy skew, etc.)
                  // must not leave the trigger disabled+loading forever: clear
                  // the pending state and surface the existing inline error
                  // affordance so the user can retry.
                  setModalLoading(false);
                  setProviderError(HARNESS_PANE_COPY.providerPickerLoadError);
                });
            }}
          >
            {HARNESS_PANE_COPY.providersConfigure}
          </Button>
          <p className="text-ui-sm text-muted-foreground/65">
            {HARNESS_PANE_COPY.providersCliNote}
          </p>
        </div>
        {!modalOpen && providerError && (
          <p role="alert" className="text-ui-sm text-destructive">
            {providerError}
          </p>
        )}
      </div>

      {modalOpen ? (
        <Suspense fallback={null}>
          <ProviderPickerModal
            open
            onClose={() => {
              setProviderError(null);
              setModalOpen(false);
            }}
            configuredProviderIds={configured
              .map(({ row }) => row.providerHint)
              .filter((hint): hint is string => typeof hint === "string" && hint.length > 0)}
            boundEnvVarNames={boundEnvVarNames}
            keysById={new Map(
              (editor.apiKeysQuery.data ?? []).map((key) => [key.id, key]),
            )}
            rowKeyIdsByEnvVar={rowKeyIdsByEnvVar}
            submitting={createKey.isPending || editor.busy}
            error={providerError}
            onSubmit={handleProviderSubmit}
            onRemove={handleProviderRemove}
          />
        </Suspense>
      ) : null}
    </SettingsSection>
  );
}
