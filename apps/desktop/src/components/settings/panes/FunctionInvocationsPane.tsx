import { useState } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { ConfirmationDialog } from "@proliferate/ui/primitives/ConfirmationDialog";
import { SettingsEmptyState } from "@proliferate/product-ui/settings/SettingsEmptyState";
import { SettingsPageHeader } from "@proliferate/product-ui/settings/SettingsPageHeader";
import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";
import type {
  FunctionInvocation,
  FunctionInvocationMethod,
} from "@proliferate/cloud-sdk/client/integrations";
import {
  FunctionInvocationFormDialog,
  type FunctionInvocationSubmitInput,
} from "@/components/settings/panes/functions/FunctionInvocationFormDialog";
import { FunctionInvocationRow } from "@/components/settings/panes/functions/FunctionInvocationRow";
import { RotateFunctionInvocationHeadersDialog } from "@/components/settings/panes/functions/RotateFunctionInvocationHeadersDialog";
import {
  useFunctionInvocationActions,
  useFunctionInvocations,
} from "@/hooks/access/cloud/integrations/use-function-invocations";
import { useToastStore } from "@/stores/toast/toast-store";

/**
 * Personal "Functions" settings pane (track 1b phase 3, below Integrations):
 * function-invocation CRUD + the per-invocation half of the §2 "default
 * access modes" knob (the chat-enable toggle on each row). Person-scoped —
 * no organization selector, matching the backend's ``owner_user_id`` scope.
 */
export function FunctionInvocationsPane() {
  const invocationsQuery = useFunctionInvocations();
  const {
    create,
    creating,
    update,
    updating,
    rotateHeaders,
    rotatingHeaders,
    setChatScopeEnabled,
    archive,
  } = useFunctionInvocationActions();
  const showToast = useToastStore((state) => state.show);

  const [formTarget, setFormTarget] = useState<"create" | FunctionInvocation | null>(null);
  const [headersTarget, setHeadersTarget] = useState<FunctionInvocation | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FunctionInvocation | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [togglingName, setTogglingName] = useState<string | null>(null);

  const invocations = invocationsQuery.data?.items ?? [];
  const editing = formTarget && formTarget !== "create" ? formTarget : null;

  async function handleFormSubmit(input: FunctionInvocationSubmitInput) {
    if (editing) {
      await update({
        name: editing.name,
        input: {
          displayName: input.displayName,
          description: input.description,
          endpointUrl: input.endpointUrl,
          method: input.method as FunctionInvocationMethod,
          argsSchema: input.argsSchema,
        },
      });
      showToast(`${input.name} updated.`, "info");
    } else {
      await create({
        name: input.name,
        displayName: input.displayName,
        description: input.description,
        endpointUrl: input.endpointUrl,
        method: input.method as FunctionInvocationMethod,
        argsSchema: input.argsSchema,
      });
      showToast(`${input.name} created.`, "info");
    }
    setFormTarget(null);
  }

  async function handleRotateHeadersSubmit(headers: Record<string, string> | null) {
    if (!headersTarget) {
      return;
    }
    await rotateHeaders({ name: headersTarget.name, headers });
    showToast(headers ? "Headers saved." : "Headers cleared.", "info");
    setHeadersTarget(null);
  }

  async function handleToggleChatScope(invocation: FunctionInvocation, enabled: boolean) {
    setTogglingName(invocation.name);
    try {
      await setChatScopeEnabled({ name: invocation.name, enabled });
    } catch {
      showToast(`${invocation.name}'s chat access could not be changed.`);
    } finally {
      setTogglingName(null);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) {
      return;
    }
    setDeleting(true);
    try {
      await archive(deleteTarget.name);
      showToast(`${deleteTarget.name} deleted.`, "info");
    } catch {
      showToast(`${deleteTarget.name} could not be deleted.`);
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }

  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Functions"
        description="HTTP functions your agents can call by name. New functions are workflow-only until you enable them for chat."
        action={
          <Button type="button" variant="secondary" onClick={() => setFormTarget("create")}>
            New function
          </Button>
        }
      />

      {invocationsQuery.isLoading ? (
        <div className="text-xs text-muted-foreground">Loading functions...</div>
      ) : invocationsQuery.isError ? (
        <SettingsEmptyState
          size="compact"
          title="Functions could not be loaded."
          action={
            <Button type="button" variant="secondary" onClick={() => { void invocationsQuery.refetch(); }}>
              Retry
            </Button>
          }
        />
      ) : invocations.length === 0 ? (
        <SettingsEmptyState
          size="compact"
          title="No functions yet."
          description="Create one to let your agents call an HTTP endpoint by name."
        />
      ) : (
        <SettingsSection title="Your functions">
          {invocations.map((invocation) => (
            <FunctionInvocationRow
              key={invocation.id}
              invocation={invocation}
              togglingChatScope={togglingName === invocation.name}
              onEdit={(target) => setFormTarget(target)}
              onRotateHeaders={(target) => setHeadersTarget(target)}
              onToggleChatScope={(target, enabled) => {
                void handleToggleChatScope(target, enabled);
              }}
              onRequestDelete={setDeleteTarget}
            />
          ))}
        </SettingsSection>
      )}

      <FunctionInvocationFormDialog
        open={formTarget !== null}
        editing={editing}
        saving={editing ? updating : creating}
        onClose={() => setFormTarget(null)}
        onSubmit={handleFormSubmit}
      />

      <RotateFunctionInvocationHeadersDialog
        invocation={headersTarget}
        saving={rotatingHeaders}
        onClose={() => setHeadersTarget(null)}
        onSubmit={handleRotateHeadersSubmit}
      />

      <ConfirmationDialog
        open={deleteTarget !== null}
        title={`Delete ${deleteTarget?.name ?? "function"}?`}
        description="Agents and workflows lose access to this function immediately. This can't be undone."
        confirmLabel="Delete"
        confirmVariant="destructive"
        loading={deleting}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          void handleDelete();
        }}
      />
    </section>
  );
}
