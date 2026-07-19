import { useRef, useState, type FormEvent } from "react";
import type { AgentApiKey } from "@proliferate/cloud-sdk";
import { ProliferateClientError } from "@proliferate/cloud-sdk";
import {
  useAgentApiKeys,
  useCreateAgentApiKey,
  useRevokeAgentApiKey,
} from "@proliferate/cloud-sdk-react";
import { Button } from "@proliferate/ui/primitives/Button";
import { Badge } from "@proliferate/ui/primitives/Badge";
import { ConfirmationDialog } from "@proliferate/ui/primitives/ConfirmationDialog";
import { Input } from "@proliferate/ui/primitives/Input";
import { Label } from "@proliferate/ui/primitives/Label";
import { SettingsPageHeader } from "@proliferate/product-ui/settings/SettingsPageHeader";
import { SettingsRow } from "@proliferate/product-ui/settings/SettingsRow";
import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";
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

export function ApiKeysPane() {
  const { cloudActive, authStatus, cloudComputeEnabled } = useCloudAvailabilityState();
  const showToast = useToastStore((state) => state.show);

  const keysQuery = useAgentApiKeys(cloudActive);
  const createKey = useCreateAgentApiKey();
  const revokeKey = useRevokeAgentApiKey();

  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [pendingRevoke, setPendingRevoke] = useState<AgentApiKey | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const retryInFlight = useRef(false);

  const keys = keysQuery.data ?? [];
  const canSubmit =
    title.trim().length > 0 && value.trim().length > 0 && !createKey.isPending;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    createKey.mutate(
      { title: title.trim(), value: value.trim() },
      {
        onSuccess: (created) => {
          setTitle("");
          setValue("");
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
    setIsRetrying(true);
    void keysQuery.refetch().finally(() => {
      retryInFlight.current = false;
      setIsRetrying(false);
    });
  }

  if (!cloudActive) {
    // Truthful cause: a signed-in user on a compute-unconfigured deployment
    // gets the operator explanation, not a "sign in" prompt they can't act on
    // (PR2-GATING-01 class). Anonymous users still get the sign-in prompt.
    const description = authStatus === "authenticated" && !cloudComputeEnabled
      ? AGENT_API_KEYS_COPY.cloudNotConfigured
      : AGENT_API_KEYS_COPY.signInRequired;
    return (
      <section className="space-y-5" data-api-keys-pane="" data-api-keys-state="gated">
        <SettingsPageHeader
          title={AGENT_API_KEYS_COPY.title}
          description={AGENT_API_KEYS_COPY.description}
        />
        <SettingsSection>
          <SettingsRow
            label={AGENT_API_KEYS_COPY.title}
            description={description}
          />
        </SettingsSection>
      </section>
    );
  }

  const keysState = keysQuery.isLoading
    ? "loading"
    : keysQuery.isError
      ? "error"
      : "ready";

  return (
    <section className="space-y-6" data-api-keys-pane="" data-api-keys-state={keysState}>
      <SettingsPageHeader
        title={AGENT_API_KEYS_COPY.title}
        description={AGENT_API_KEYS_COPY.description}
      />

      <SettingsSection
        title={AGENT_API_KEYS_COPY.keysSection}
        action={keysQuery.isLoading || keysQuery.isError ? null : (
          <Badge tone={keys.length > 0 ? "success" : "neutral"}>
            {keys.length} {keys.length === 1 ? "key" : "keys"}
          </Badge>
        )}
      >
        {keysQuery.isLoading ? (
          <SettingsRow
            label={AGENT_API_KEYS_COPY.keysSection}
            description={AGENT_API_KEYS_COPY.loading}
          />
        ) : keysQuery.isError ? (
          <SettingsRow
            label={AGENT_API_KEYS_COPY.keysSection}
            description={AGENT_API_KEYS_COPY.loadError}
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              loading={isRetrying}
              onClick={handleRetry}
            >
              {isRetrying
                ? AGENT_API_KEYS_COPY.retryingAction
                : AGENT_API_KEYS_COPY.retryAction}
            </Button>
          </SettingsRow>
        ) : keys.length === 0 ? (
          <SettingsRow
            label={AGENT_API_KEYS_COPY.emptyTitle}
            description={AGENT_API_KEYS_COPY.emptyDescription}
          />
        ) : (
          keys.map((key) => (
            <SettingsRow
              key={key.id}
              label={
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate">{key.title}</span>
                  <span className="font-mono text-xs font-normal text-muted-foreground">
                    {key.redactedHint}
                  </span>
                </span>
              }
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
          ))
        )}
      </SettingsSection>

      <SettingsSection
        title={AGENT_API_KEYS_COPY.addSection}
        description={AGENT_API_KEYS_COPY.addSectionDescription}
      >
        <form
          className="flex flex-col gap-2 rounded-lg border border-border bg-foreground/[0.02] p-3.5 sm:flex-row"
          onSubmit={handleSubmit}
        >
          <div className="sm:flex-1">
            <Label htmlFor="agent-api-key-title" className="sr-only">
              {AGENT_API_KEYS_COPY.titleLabel}
            </Label>
            <Input
              id="agent-api-key-title"
              aria-label={AGENT_API_KEYS_COPY.titleLabel}
              placeholder={AGENT_API_KEYS_COPY.titlePlaceholder}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <Input
            aria-label={AGENT_API_KEYS_COPY.valueLabel}
            placeholder={AGENT_API_KEYS_COPY.valuePlaceholder}
            type="password"
            autoComplete="off"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className="sm:flex-1"
          />
          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={!canSubmit}
            loading={createKey.isPending}
          >
            {AGENT_API_KEYS_COPY.addAction}
          </Button>
        </form>
      </SettingsSection>

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
    </section>
  );
}
