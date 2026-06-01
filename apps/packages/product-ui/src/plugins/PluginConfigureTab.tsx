
import { ExternalLink, Laptop, Trash2 } from "lucide-react";
import type {
  PluginConnectionDraft,
  PluginInventoryItem,
  PluginSettings,
  PluginSurfaceKind,
} from "@proliferate/product-domain/plugins/cloud-plugin-inventory";
import { Button } from "@proliferate/ui/primitives/Button";
import { Switch } from "@proliferate/ui/primitives/Switch";
import { PluginSecretFields, PluginSettingsFields } from "./PluginSettingsFields";
import type { PluginModalMode } from "./plugin-types";

export function PluginConfigureTab({
  canShare,
  canCancelSubmission,
  canSubmit,
  cancelingSubmission,
  disabledOnSurface,
  draft,
  error,
  item,
  mode,
  primaryLabel,
  shareOrganizationName,
  submitting,
  surface,
  onClose,
  onCancelSubmission,
  onDraftSecretChange,
  onDraftSettingsChange,
  onOpenDesktop,
  onOpenDocs,
  onRequestDelete,
  onShareChange,
  onSubmit,
  onToggleEnabled,
}: {
  canShare: boolean;
  canCancelSubmission: boolean;
  canSubmit: boolean;
  cancelingSubmission: boolean;
  disabledOnSurface: boolean;
  draft: PluginConnectionDraft;
  error: string | null;
  item: PluginInventoryItem;
  mode: PluginModalMode;
  primaryLabel: string | null;
  shareOrganizationName: string | null;
  submitting: boolean;
  surface: PluginSurfaceKind;
  onClose: () => void;
  onCancelSubmission: () => void;
  onDraftSettingsChange: (settings: PluginSettings | undefined) => void;
  onDraftSecretChange: (fieldId: string, value: string) => void;
  onOpenDesktop: () => void;
  onOpenDocs: (url: string) => void;
  onRequestDelete: (item: PluginInventoryItem) => void;
  onShareChange: (item: PluginInventoryItem, publicToOrg: boolean) => void;
  onSubmit: () => void;
  onToggleEnabled: (item: PluginInventoryItem, enabled: boolean) => void;
}) {
  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      {item.unavailableReason && mode === "connect" ? (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          {item.unavailableReason}
        </div>
      ) : null}

      <PluginSetupFields
        draft={draft}
        item={item}
        mode={mode}
        submitting={submitting}
        onDraftSecretChange={onDraftSecretChange}
        onDraftSettingsChange={onDraftSettingsChange}
        onOpenDocs={onOpenDocs}
      />

      {mode === "manage" && item.connection ? (
        <PluginManageSettings
          canShare={canShare}
          item={item}
          shareOrganizationName={shareOrganizationName}
          submitting={submitting}
          onShareChange={onShareChange}
          onToggleEnabled={onToggleEnabled}
        />
      ) : null}

      <PluginPrimaryAction
        canSubmit={canSubmit}
        disabledOnSurface={disabledOnSurface}
        item={item}
        mode={mode}
        primaryLabel={primaryLabel}
        submitting={submitting}
        surface={surface}
        canCancelSubmission={canCancelSubmission}
        cancelingSubmission={cancelingSubmission}
        onClose={onClose}
        onCancelSubmission={onCancelSubmission}
        onOpenDesktop={onOpenDesktop}
        onRequestDelete={onRequestDelete}
        onSubmit={onSubmit}
      />
    </div>
  );
}

function PluginSetupFields({
  draft,
  item,
  mode,
  submitting,
  onDraftSecretChange,
  onDraftSettingsChange,
  onOpenDocs,
}: {
  draft: PluginConnectionDraft;
  item: PluginInventoryItem;
  mode: PluginModalMode;
  submitting: boolean;
  onDraftSettingsChange: (settings: PluginSettings | undefined) => void;
  onDraftSecretChange: (fieldId: string, value: string) => void;
  onOpenDocs: (url: string) => void;
}) {
  if (item.setupVariant === "api_key") {
    return (
      <div className="space-y-4">
        <PluginSettingsFields
          fields={item.entry.settingsSchema}
          settings={draft.settings}
          disabled={submitting}
          onChange={onDraftSettingsChange}
        />
        <PluginSecretFields
          item={item}
          draft={draft}
          mode={mode}
          disabled={submitting}
          autoFocus={item.entry.settingsSchema.length === 0}
          onChange={onDraftSecretChange}
          onOpenDocs={onOpenDocs}
        />
      </div>
    );
  }

  if (item.setupVariant === "oauth_structured") {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{item.entry.description}</p>
        <PluginSettingsFields
          fields={item.entry.settingsSchema}
          settings={draft.settings}
          disabled={submitting}
          onChange={onDraftSettingsChange}
          helperText={mode === "manage"
            ? "Changing project scope or access mode requires reconnecting in your browser."
            : "Authorize the specific project and access mode you choose here."}
        />
      </div>
    );
  }

  if (item.setupVariant === "local_oauth") {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{item.entry.description}</p>
        {mode === "manage" ? (
          <PluginSettingsFields
            fields={item.entry.settingsSchema}
            settings={draft.settings}
            disabled
            onChange={onDraftSettingsChange}
            helperText="This account is local to this desktop. Delete and reconnect to use another account."
          />
        ) : (
          <div className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            Choose the account in your browser. Managed cloud sandboxes use the account after runtime config refresh.
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{item.entry.description}</p>
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {item.setupVariant === "no_setup"
            ? "This plugin doesn't need any saved credentials."
            : "You'll finish setup in your browser."}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onOpenDocs(item.entry.docsUrl)}
        >
          Learn more
          <ExternalLink size={12} />
        </Button>
      </div>
    </div>
  );
}

function PluginManageSettings({
  canShare,
  item,
  shareOrganizationName,
  submitting,
  onShareChange,
  onToggleEnabled,
}: {
  canShare: boolean;
  item: PluginInventoryItem;
  shareOrganizationName: string | null;
  submitting: boolean;
  onShareChange: (item: PluginInventoryItem, publicToOrg: boolean) => void;
  onToggleEnabled: (item: PluginInventoryItem, enabled: boolean) => void;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-border/60 bg-surface-elevated-secondary px-3 py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground">Enabled for new sessions</div>
          <p className="mt-1 text-xs text-muted-foreground">
            MCP tools and default plugin skills can be picked up by new cloud sessions.
          </p>
        </div>
        <Switch
          checked={item.enabled}
          disabled={submitting}
          onChange={(enabled) => onToggleEnabled(item, enabled)}
          aria-label={`${item.enabled ? "Disable" : "Enable"} ${item.entry.name}`}
        />
      </div>
      <div className="flex items-center justify-between gap-4 border-t border-border/60 pt-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground">Share with team cloud</div>
          <p className="mt-1 text-xs text-muted-foreground">
            {shareOrganizationName
              ? `Make this available to ${shareOrganizationName} automations, Slack, and shared cloud work.`
              : "Create or join a team before sharing plugin access."}
          </p>
        </div>
        <Switch
          checked={item.isFullyPublic}
          disabled={submitting || !canShare}
          onChange={(publicToOrg) => onShareChange(item, publicToOrg)}
          aria-label={`${item.isFullyPublic ? "Stop sharing" : "Share"} ${item.entry.name}`}
        />
      </div>
    </div>
  );
}

function PluginPrimaryAction({
  canCancelSubmission,
  canSubmit,
  cancelingSubmission,
  disabledOnSurface,
  item,
  mode,
  primaryLabel,
  submitting,
  surface,
  onClose,
  onCancelSubmission,
  onOpenDesktop,
  onRequestDelete,
  onSubmit,
}: {
  canCancelSubmission: boolean;
  canSubmit: boolean;
  cancelingSubmission: boolean;
  disabledOnSurface: boolean;
  item: PluginInventoryItem;
  mode: PluginModalMode;
  primaryLabel: string | null;
  submitting: boolean;
  surface: PluginSurfaceKind;
  onClose: () => void;
  onCancelSubmission: () => void;
  onOpenDesktop: () => void;
  onRequestDelete: (item: PluginInventoryItem) => void;
  onSubmit: () => void;
}) {
  if (disabledOnSurface && mode === "connect" && surface === "web") {
    return (
      <Button type="button" variant="secondary" size="md" onClick={onOpenDesktop} className="w-full rounded-[10px]">
        <Laptop size={15} />
        Open Desktop
      </Button>
    );
  }

  return (
    <div className="space-y-2 pt-1">
      {primaryLabel ? (
        <Button
          type="button"
          variant="primary"
          size="md"
          disabled={!canSubmit}
          loading={submitting}
          onClick={onSubmit}
          className="w-full rounded-[10px]"
        >
          {primaryLabel}
        </Button>
      ) : null}
      {mode === "manage" ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={submitting}
          onClick={() => onRequestDelete(item)}
          className="w-full text-destructive hover:text-destructive"
        >
          <Trash2 size={14} />
          Delete
        </Button>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={submitting && !canCancelSubmission}
          loading={cancelingSubmission}
          onClick={canCancelSubmission ? onCancelSubmission : onClose}
          className="w-full"
        >
          Cancel
        </Button>
      )}
    </div>
  );
}
