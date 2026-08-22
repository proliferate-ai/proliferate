import { useEffect, useRef, useState } from "react";
import type { AgentApiKey } from "@proliferate/cloud-sdk";
import { ProliferateClientError } from "@proliferate/cloud-sdk";
import {
  useAgentApiKeys,
  useCreateAgentApiKey,
  useRevokeAgentApiKey,
} from "@proliferate/cloud-sdk-react";
import { Plus } from "#product/primitives/icons/core";
import { Button } from "#product/primitives/Button";
import { ConfirmationDialog } from "#product/primitives/patterns/ConfirmationDialog";
import { PageHeader } from "#product/primitives/patterns/PageHeader";
import { SettingsEmptyState } from "#product/primitives/patterns/settings/SettingsEmptyState";
import { SettingsPageBody } from "#product/primitives/patterns/settings/SettingsPageBody";
import { SettingsRow } from "#product/primitives/patterns/settings/SettingsRow";
import { SettingsSection } from "#product/primitives/patterns/settings/SettingsSection";
import { ApiKeyCreatorModal, type ApiKeyCreatorSubmit } from "#product/components/settings/panes/agent-auth/ApiKeyCreatorModal";
import { AGENT_API_KEYS_COPY } from "#product/copy/settings/agent-api-keys-copy";
import { useCloudAvailabilityState } from "#product/hooks/cloud/derived/use-cloud-availability-state";
import { useToastStore } from "#product/stores/toast/toast-store";

// A 409 from the revoke endpoint carries the harnesses whose enabled selections
// still wire the key (contract §5); surface them so the user knows what to
// disable first.
function revokeConflictHarnesses(error: unknown): string[] | null {
  if (error instanceof ProliferateClientError && error.status === 409) {
    const harnesses = error.details.harnesses;
    if (Array.isArray(harnesses) && harnesses.every((h) => typeof h === "string")) {
      return harnesses as string[];
    }
  }
  return null;
}

function formatCreatedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

export function ApiKeysPane() {
  const { authStatus, controlPlaneReachable } = useCloudAvailabilityState();
  const showToast = useToastStore((state) => state.show);

  // The API key vault is a control-plane feature, not a cloud-compute one: it
  // must stay usable whenever the control plane is reachable and the user is
  // signed in, independent of `cloudComputeEnabled` (ADR FM6/Q9). The settings
  // router already routes this pane through exactly that gate
  // (render-settings-section.tsx `authGate`); gating the pane body on
  // `cloudActive` re-coupled it to cloud compute and slammed the door the
  // router had just opened.
  const authReady = authStatus === "authenticated" && controlPlaneReachable;

  const keysQuery = useAgentApiKeys(authReady);
  const createKey = useCreateAgentApiKey();
  const revokeKey = useRevokeAgentApiKey();

  const [addOpen, setAddOpen] = useState(false);
  const [pendingRevoke, setPendingRevoke] = useState<AgentApiKey | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const retryInFlight = useRef(false);
  const retryGeneration = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      retryGeneration.current += 1;
      retryInFlight.current = false;
    };
  }, []);

  const keys = keysQuery.data ?? [];

  function handleCreate(input: ApiKeyCreatorSubmit) {
    createKey.mutate(
      { title: input.title, value: input.value },
      {
        onSuccess: (created) => {
          setAddOpen(false);
          showToast(`Added API key ${created.title}.`, "info");
        },
        onError: (error) => {
          showToast(error.message || AGENT_API_KEYS_COPY.addError);
        },
      },
    );
  }

  function handleConfirmRevoke() {
    if (!pendingRevoke) {
      return;
    }
    revokeKey.mutate(pendingRevoke.id, {
      onSuccess: () => {
        setPendingRevoke(null);
        showToast(AGENT_API_KEYS_COPY.revokedToast, "info");
      },
      onError: (error) => {
        setPendingRevoke(null);
        const harnesses = revokeConflictHarnesses(error);
        showToast(
          harnesses
            ? AGENT_API_KEYS_COPY.revokeReferencedError(harnesses)
            : error.message || AGENT_API_KEYS_COPY.revokeError,
        );
      },
    });
  }

  function handleRetry() {
    if (retryInFlight.current) {
      return;
    }
    retryInFlight.current = true;
    const generation = retryGeneration.current + 1;
    retryGeneration.current = generation;
    setIsRetrying(true);
    void (async () => {
      try {
        await keysQuery.refetch();
      } catch {
        // The query error state is the recovery surface; consume transport
        // rejections so Retry can return to a usable state.
      } finally {
        if (!mounted.current || retryGeneration.current !== generation) {
          return;
        }
        retryInFlight.current = false;
        setIsRetrying(false);
      }
    })();
  }

  if (!authReady) {
    // Truthful cause: a signed-in user whose control plane is unreachable gets
    // a connectivity explanation, not a "sign in" prompt they can't act on
    // (PR2-GATING-01 class). Anonymous users still get the sign-in prompt.
    const unreachable = authStatus === "authenticated" && !controlPlaneReachable;
    return (
      <SettingsPageBody data-api-keys-pane="" data-api-keys-state="gated">
        <PageHeader
          variant="flat"
          title={AGENT_API_KEYS_COPY.title}
          description={AGENT_API_KEYS_COPY.description}
        />
        <SettingsEmptyState
          size="compact"
          title={unreachable
            ? AGENT_API_KEYS_COPY.serverUnreachableTitle
            : AGENT_API_KEYS_COPY.signInRequiredTitle}
          description={unreachable
            ? AGENT_API_KEYS_COPY.serverUnreachable
            : AGENT_API_KEYS_COPY.signInRequired}
        />
      </SettingsPageBody>
    );
  }

  const keysState = keysQuery.isLoading
    ? "loading"
    : keysQuery.isError
      ? "error"
      : "ready";

  return (
    <SettingsPageBody data-api-keys-pane="" data-api-keys-state={keysState}>
      <PageHeader
        variant="flat"
        title={AGENT_API_KEYS_COPY.title}
        description={AGENT_API_KEYS_COPY.description}
        action={
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="gap-1.5"
            onClick={() => setAddOpen(true)}
          >
            <Plus className="icon-paired" />
            {AGENT_API_KEYS_COPY.addAction}
          </Button>
        }
      />

      {keysQuery.isLoading ? (
        <div className="text-ui-sm text-muted-foreground">{AGENT_API_KEYS_COPY.loading}</div>
      ) : keysQuery.isError ? (
        <SettingsEmptyState
          size="compact"
          title={AGENT_API_KEYS_COPY.loadError}
          action={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={isRetrying}
              onClick={handleRetry}
            >
              {isRetrying
                ? AGENT_API_KEYS_COPY.retryingAction
                : AGENT_API_KEYS_COPY.retryAction}
            </Button>
          }
        />
      ) : keys.length === 0 ? (
        <SettingsEmptyState
          size="compact"
          title={AGENT_API_KEYS_COPY.emptyTitle}
          description={AGENT_API_KEYS_COPY.emptyDescription}
        />
      ) : (
        <SettingsSection title={AGENT_API_KEYS_COPY.keysSection}>
          {keys.map((key) => (
            <SettingsRow
              key={key.id}
              label={
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate">{key.title}</span>
                  <span className="font-mono text-ui-sm font-normal text-muted-foreground">
                    {key.redactedHint}
                  </span>
                </span>
              }
              description={AGENT_API_KEYS_COPY.createdDetail(formatCreatedAt(key.createdAt))}
            >
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setPendingRevoke(key)}
              >
                {AGENT_API_KEYS_COPY.revokeAction}
              </Button>
            </SettingsRow>
          ))}
        </SettingsSection>
      )}

      <ApiKeyCreatorModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        heading={AGENT_API_KEYS_COPY.addModalHeading}
        description={AGENT_API_KEYS_COPY.addModalDescription}
        showTitleField
        submitLabel={AGENT_API_KEYS_COPY.addAction}
        submitting={createKey.isPending}
        error={null}
        onSubmit={handleCreate}
      />

      <ConfirmationDialog
        open={pendingRevoke !== null}
        title={AGENT_API_KEYS_COPY.revokeTitle}
        description={pendingRevoke
          ? AGENT_API_KEYS_COPY.revokeDescription(pendingRevoke.title)
          : ""}
        confirmLabel={AGENT_API_KEYS_COPY.revokeConfirmLabel}
        confirmVariant="destructive"
        loading={revokeKey.isPending}
        onClose={() => setPendingRevoke(null)}
        onConfirm={handleConfirmRevoke}
      />
    </SettingsPageBody>
  );
}
