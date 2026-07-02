import { useEffect, useState } from "react";
import type {
  AgentAuthRouteSelection,
  AgentAuthSurface,
  AgentGatewayProviderInfo,
} from "@proliferate/cloud-sdk";
import {
  useAgentApiKeys,
  useAgentGatewayCapabilities,
  useAgentGatewayEnrollment,
  useClearRouteSelection,
  useRouteSelections,
  useUpsertRouteSelection,
} from "@proliferate/cloud-sdk-react";
import { ExternalLink } from "@proliferate/ui/icons";
import { Badge } from "@proliferate/ui/primitives/Badge";
import { Button } from "@proliferate/ui/primitives/Button";
import { Switch } from "@proliferate/ui/primitives/Switch";
import { SettingsRow } from "@proliferate/product-ui/settings/SettingsRow";
import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";
import { gatewaySubtitle } from "@/components/settings/panes/agent-auth/agent-auth-copy";
import { KeyPicker } from "@/components/settings/panes/agent-auth/KeyPicker";
import { HARNESS_PANE_COPY } from "@/copy/settings/harness-pane";
import { useTauriShellActions } from "@/hooks/access/tauri/use-shell-actions";
import { useCloudAvailabilityState } from "@/hooks/cloud/derived/use-cloud-availability-state";
import { useToastStore } from "@/stores/toast/toast-store";

const OPENCODE_HARNESS = "opencode";
const GATEWAY_SLOT = "gateway";

interface OpenCodeHarnessAuthSectionProps {
  displayName: string;
  surface: AgentAuthSurface;
}

/**
 * OpenCode composes model sources instead of picking one (spec §3.3 slot
 * semantics): the managed gateway plus any number of direct provider keys are
 * independent per-source switches, each persisted as its own route-selection
 * slot. Provider rows come from the server's provider registry (capabilities)
 * so nothing here is hardcoded.
 */
export function OpenCodeHarnessAuthSection({
  displayName,
  surface,
}: OpenCodeHarnessAuthSectionProps) {
  const { cloudActive } = useCloudAvailabilityState();
  const showToast = useToastStore((state) => state.show);
  const { openExternal } = useTauriShellActions();

  // Provider rows toggled on but with no key attached yet (per surface+slot).
  const [draftSlots, setDraftSlots] = useState<Record<string, boolean>>({});

  const capabilitiesQuery = useAgentGatewayCapabilities(cloudActive);
  const enrollmentQuery = useAgentGatewayEnrollment(cloudActive);
  const selectionsQuery = useRouteSelections(cloudActive);
  const apiKeysQuery = useAgentApiKeys(cloudActive);
  const upsertSelection = useUpsertRouteSelection();
  const clearSelection = useClearRouteSelection();

  useEffect(() => {
    setDraftSlots({});
  }, [surface]);

  if (!cloudActive) {
    return (
      <SettingsSection title={HARNESS_PANE_COPY.signInTitle}>
        <p className="py-3 text-sm text-muted-foreground">
          {HARNESS_PANE_COPY.signInDescription(displayName)}
        </p>
      </SettingsSection>
    );
  }

  const capabilities = capabilitiesQuery.data;
  const enrollment = enrollmentQuery.data;
  const gatewayLocked =
    !capabilities?.gatewayEnabled ||
    (enrollment !== undefined && enrollment.syncStatus !== "synced");
  const providers = (capabilities?.providers ?? []).filter((provider) =>
    provider.harnesses.includes(OPENCODE_HARNESS),
  );
  const apiKeys = apiKeysQuery.data?.keys ?? [];
  const busy = upsertSelection.isPending || clearSelection.isPending;

  function selectionForSlot(slot: string): AgentAuthRouteSelection | null {
    return (
      selectionsQuery.data?.selections.find(
        (entry) =>
          entry.harnessKind === OPENCODE_HARNESS
          && entry.surface === surface
          && entry.slot === slot,
      ) ?? null
    );
  }

  function setDraft(slot: string, active: boolean) {
    setDraftSlots((current) => ({ ...current, [slot]: active }));
  }

  function isDraft(slot: string): boolean {
    return draftSlots[slot] ?? false;
  }

  function upsertSlot(slot: string, route: "gateway" | "api_key", apiKeyId?: string) {
    upsertSelection.mutate(
      {
        harnessKind: OPENCODE_HARNESS,
        surface,
        body: route === "api_key"
          ? { route, apiKeyId: apiKeyId ?? null, slot }
          : { route, slot },
      },
      {
        onSuccess: () => setDraft(slot, false),
        onError: (error) => {
          showToast(error.message || HARNESS_PANE_COPY.sourcesUpdateError(displayName));
        },
      },
    );
  }

  function clearSlot(slot: string) {
    clearSelection.mutate(
      { harnessKind: OPENCODE_HARNESS, surface, slot },
      {
        onError: (error) => {
          showToast(error.message || HARNESS_PANE_COPY.sourcesUpdateError(displayName));
        },
      },
    );
  }

  function handleGatewayToggle(next: boolean) {
    if (next) {
      upsertSlot(GATEWAY_SLOT, "gateway");
    } else {
      clearSlot(GATEWAY_SLOT);
    }
  }

  function handleProviderToggle(provider: AgentGatewayProviderInfo, next: boolean) {
    const selection = selectionForSlot(provider.id);
    if (!next) {
      setDraft(provider.id, false);
      if (selection) {
        clearSlot(provider.id);
      }
      return;
    }
    // Enabling a provider needs a key; wait for an explicit pick.
    setDraft(provider.id, true);
  }

  function providerRow(provider: AgentGatewayProviderInfo) {
    const selection = selectionForSlot(provider.id);
    const enabled = selection !== null || isDraft(provider.id);
    return (
      // Wrapping breaks SettingsRow's own first:border-t-0 divider chain, so
      // the wrapper carries the hairline between rows instead.
      <div key={provider.id} className="border-t border-border">
        <SettingsRow
          label={
            <span className="flex items-center gap-2">
              {provider.label}
              {provider.recommendedFor.includes(OPENCODE_HARNESS) ? (
                <Badge tone="neutral">{HARNESS_PANE_COPY.recommendedBadge}</Badge>
              ) : null}
            </span>
          }
          description={
            <Button
              type="button"
              variant="unstyled"
              size="unstyled"
              className="inline-flex items-center gap-1 hover:text-foreground"
              onClick={() => { void openExternal(provider.keyUrl); }}
            >
              {HARNESS_PANE_COPY.getApiKey}
              <ExternalLink className="size-3" />
            </Button>
          }
        >
          <Switch
            aria-label={`${provider.label} key`}
            checked={enabled}
            disabled={busy}
            onChange={(next) => handleProviderToggle(provider, next)}
          />
        </SettingsRow>
        {enabled ? (
          <div className="pb-3 sm:w-80">
            <KeyPicker
              keys={apiKeys}
              provider={provider.id}
              selectedKeyId={selection?.apiKeyId ?? null}
              disabled={busy}
              onSelect={(keyId) => upsertSlot(provider.id, "api_key", keyId)}
            />
          </div>
        ) : null}
      </div>
    );
  }

  const gatewaySelection = selectionForSlot(GATEWAY_SLOT);

  return (
    <SettingsSection
      title={HARNESS_PANE_COPY.authenticationTitle}
      description={HARNESS_PANE_COPY.openCodeDescription(displayName)}
    >
      {selectionsQuery.isLoading || capabilitiesQuery.isLoading ? (
        <p className="py-3 text-sm text-muted-foreground">Loading model sources...</p>
      ) : (
        <>
          <SettingsRow
            label={HARNESS_PANE_COPY.gatewayLabel}
            description={gatewaySubtitle(capabilities, enrollment)}
          >
            <Switch
              aria-label={HARNESS_PANE_COPY.gatewayLabel}
              checked={gatewaySelection !== null}
              disabled={gatewayLocked || busy}
              onChange={handleGatewayToggle}
            />
          </SettingsRow>
          {providers.map((provider) => providerRow(provider))}
        </>
      )}
    </SettingsSection>
  );
}
