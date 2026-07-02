import { useState } from "react";
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
import { Tabs } from "@proliferate/ui/primitives/Tabs";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { useTauriShellActions } from "@/hooks/access/tauri/use-shell-actions";
import { useCloudAvailabilityState } from "@/hooks/cloud/derived/use-cloud-availability-state";
import { useToastStore } from "@/stores/toast/toast-store";
import { gatewaySubtitle } from "@/copy/settings/agent-auth-copy";
import { KeyPicker } from "./KeyPicker";

const OPENCODE_HARNESS = "opencode";
const GATEWAY_SLOT = "gateway";

const SURFACE_TABS = [
  { id: "local", label: "Local" },
  { id: "cloud", label: "Cloud" },
] as const;

interface OpenCodeAuthSectionProps {
  displayName: string;
}

/**
 * OpenCode composes model sources instead of picking one (spec §3.3 slot
 * semantics): the managed gateway plus any number of direct provider keys are
 * independent per-source toggles, each persisted as its own route-selection
 * slot. Provider rows come from the server's provider registry (capabilities)
 * so nothing here is hardcoded.
 */
export function OpenCodeAuthSection({ displayName }: OpenCodeAuthSectionProps) {
  const { cloudActive } = useCloudAvailabilityState();
  const showToast = useToastStore((state) => state.show);
  const { openExternal } = useTauriShellActions();

  const [surface, setSurface] = useState<AgentAuthSurface>("local");
  // Provider rows toggled on but with no key attached yet (per surface+slot).
  const [draftSlots, setDraftSlots] = useState<Record<string, boolean>>({});

  const capabilitiesQuery = useAgentGatewayCapabilities(cloudActive);
  const enrollmentQuery = useAgentGatewayEnrollment(cloudActive);
  const selectionsQuery = useRouteSelections(cloudActive);
  const apiKeysQuery = useAgentApiKeys(cloudActive);
  const upsertSelection = useUpsertRouteSelection();
  const clearSelection = useClearRouteSelection();

  if (!cloudActive) {
    return (
      <SettingsCard>
        <div className="space-y-1 px-4 py-3">
          <p className="text-sm font-semibold text-foreground">Authentication</p>
          <p className="text-sm text-muted-foreground">
            Sign in to Proliferate Cloud to manage how {displayName} authenticates
            to models.
          </p>
        </div>
      </SettingsCard>
    );
  }

  const capabilities = capabilitiesQuery.data;
  const enrollment = enrollmentQuery.data;
  const gatewayDisabled = capabilities !== undefined && !capabilities.gatewayEnabled;
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

  function draftKeyFor(slot: string): string {
    return `${surface}:${slot}`;
  }

  function setDraft(slot: string, active: boolean) {
    setDraftSlots((current) => ({ ...current, [draftKeyFor(slot)]: active }));
  }

  function isDraft(slot: string): boolean {
    return draftSlots[draftKeyFor(slot)] ?? false;
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
          showToast(error.message || `Could not update the ${displayName} sources.`);
        },
      },
    );
  }

  function clearSlot(slot: string) {
    clearSelection.mutate(
      { harnessKind: OPENCODE_HARNESS, surface, slot },
      {
        onError: (error) => {
          showToast(error.message || `Could not update the ${displayName} sources.`);
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
      <div key={provider.id} className="space-y-2 border-b border-border-light px-4 py-3 last:border-b-0">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 space-y-0.5">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-foreground">{provider.label}</p>
              {provider.recommendedFor.includes(OPENCODE_HARNESS) ? (
                <Badge tone="neutral">Recommended</Badge>
              ) : null}
            </div>
            <Button
              type="button"
              variant="unstyled"
              size="unstyled"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => { void openExternal(provider.keyUrl); }}
            >
              Get an API key
              <ExternalLink className="size-3" />
            </Button>
          </div>
          <Switch
            aria-label={`${provider.label} key`}
            checked={enabled}
            disabled={busy}
            onChange={(next) => handleProviderToggle(provider, next)}
          />
        </div>
        {enabled ? (
          <KeyPicker
            keys={apiKeys}
            provider={provider.id}
            selectedKeyId={selection?.apiKeyId ?? null}
            disabled={busy}
            onSelect={(keyId) => upsertSlot(provider.id, "api_key", keyId)}
          />
        ) : null}
      </div>
    );
  }

  const gatewaySelection = selectionForSlot(GATEWAY_SLOT);

  return (
    <SettingsCard>
      <div className="flex flex-col gap-2 p-4 pb-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold text-foreground">Authentication</p>
          <p className="text-sm text-muted-foreground">
            {displayName} combines sources: the gateway and your own provider keys
            can be enabled together.
          </p>
        </div>
        <Tabs
          items={SURFACE_TABS}
          activeId={surface}
          onChange={(next) => setSurface(next === "cloud" ? "cloud" : "local")}
        />
      </div>

      {selectionsQuery.isLoading || capabilitiesQuery.isLoading ? (
        <p className="px-4 pb-3 text-sm text-muted-foreground">
          Loading model sources...
        </p>
      ) : (
        <div>
          <div className="flex items-center justify-between gap-3 border-b border-border-light px-4 py-3">
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-medium text-foreground">Proliferate gateway</p>
              <p className="text-xs text-muted-foreground">
                {gatewaySubtitle(capabilities, enrollment)}
              </p>
            </div>
            <Switch
              aria-label="Proliferate gateway"
              checked={gatewaySelection !== null}
              disabled={gatewayDisabled || busy}
              onChange={handleGatewayToggle}
            />
          </div>
          {providers.map((provider) => providerRow(provider))}
        </div>
      )}
    </SettingsCard>
  );
}
