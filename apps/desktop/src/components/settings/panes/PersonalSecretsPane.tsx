import { useState } from "react";
import { usePutCloudSecretEnvVar } from "@proliferate/cloud-sdk-react";
import { Plus } from "@proliferate/ui/icons";
import { Button } from "@proliferate/ui/primitives/Button";
import { CloudSecretsSettingsSurface } from "@proliferate/product-surfaces/settings/CloudSecretsSettingsSurface";
import { SettingsPageHeader } from "@proliferate/product-ui/settings/SettingsPageHeader";
import { ApiKeyCreatorModal } from "@/components/settings/panes/agent-auth/ApiKeyCreatorModal";
import { useToastStore } from "@/stores/toast/toast-store";

const PERSONAL_SCOPE = { kind: "personal" } as const;

export function PersonalSecretsPane() {
  const [addKeyOpen, setAddKeyOpen] = useState(false);
  const putEnvVar = usePutCloudSecretEnvVar();
  const showToast = useToastStore((state) => state.show);

  function handleCreate(input: { value: string; envVarName: string }) {
    // Secrets context: the env-var field maps to the secret NAME and we call the
    // secrets putEnvVar path (create only, no agent binding). The shared modal
    // shell is identical to the agent flow — only this submit differs.
    putEnvVar.mutate(
      { scope: PERSONAL_SCOPE, name: input.envVarName, value: input.value },
      {
        onSuccess: () => {
          setAddKeyOpen(false);
          showToast("Secret saved.", "info");
        },
        onError: (error) => {
          showToast(error.message || "Could not save the secret.");
        },
      },
    );
  }

  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Personal secrets"
        description="Secrets available in your personal cloud sandbox"
        action={
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="gap-1.5"
            onClick={() => setAddKeyOpen(true)}
          >
            <Plus className="size-3.5" />
            Add API key
          </Button>
        }
      />

      <CloudSecretsSettingsSurface scope={PERSONAL_SCOPE} />

      <ApiKeyCreatorModal
        open={addKeyOpen}
        onClose={() => setAddKeyOpen(false)}
        heading="Add API key"
        description="Save a secret env var into your personal cloud sandbox."
        showTitleField={false}
        envVarField={{
          label: "Environment variable",
          placeholder: "API_TOKEN",
          helpText: "The name this secret is exposed as in your sandbox.",
        }}
        submitLabel="Save secret"
        submitting={putEnvVar.isPending}
        error={null}
        onSubmit={handleCreate}
      />
    </section>
  );
}
