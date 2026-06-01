
import { useEffect, useState, type ReactNode } from "react";
import type {
  PluginConnectionDraft,
  PluginInventoryItem,
  PluginSettings,
  PluginSurfaceKind,
} from "@proliferate/product-domain/plugins/cloud-plugin-inventory";
import { ModalShell } from "@proliferate/ui/primitives/ModalShell";
import { PluginConfigureTab } from "./PluginConfigureTab";
import { PluginDetailTabs, PluginAboutTab, PluginToolsTab } from "./PluginDetailsTabs";
import { PluginGlyph } from "./PluginGlyph";
import { primaryActionLabel } from "./plugin-presentation";
import type { PluginIconRenderer, PluginModalMode, PluginModalTab } from "./plugin-types";

export function PluginConnectionModal({
  item,
  mode,
  draft,
  submitting,
  error,
  surface,
  canShare,
  canCancelSubmission,
  cancelingSubmission,
  shareOrganizationName,
  onClose,
  onCancelSubmission,
  onDraftSettingsChange,
  onDraftSecretChange,
  onSubmit,
  onToggleEnabled,
  onShareChange,
  onOpenDocs,
  onOpenDesktop,
  onRequestDelete,
  renderIcon,
}: {
  item: PluginInventoryItem | null;
  mode: PluginModalMode;
  draft: PluginConnectionDraft | null;
  submitting: boolean;
  error: string | null;
  surface: PluginSurfaceKind;
  canShare: boolean;
  canCancelSubmission: boolean;
  cancelingSubmission: boolean;
  shareOrganizationName: string | null;
  onClose: () => void;
  onCancelSubmission: () => void;
  onDraftSettingsChange: (settings: PluginSettings | undefined) => void;
  onDraftSecretChange: (fieldId: string, value: string) => void;
  onSubmit: () => void;
  onToggleEnabled: (item: PluginInventoryItem, enabled: boolean) => void;
  onShareChange: (item: PluginInventoryItem, publicToOrg: boolean) => void;
  onOpenDocs: (url: string) => void;
  onOpenDesktop: () => void;
  onRequestDelete: (item: PluginInventoryItem) => void;
  renderIcon?: PluginIconRenderer;
}) {
  const [activeTab, setActiveTab] = useState<PluginModalTab>("configure");

  useEffect(() => {
    setActiveTab("configure");
  }, [item?.id, mode]);

  if (!item || !draft) {
    return null;
  }

  const disabledOnSurface = Boolean(item.unavailableReason);
  const primaryLabel = primaryActionLabel(item, mode, surface);
  const canSubmit = !disabledOnSurface || item.state === "installed";
  const icon = renderIcon?.(item, "sm") ?? <PluginGlyph item={item} size="sm" />;
  const closeOrCancel = canCancelSubmission ? onCancelSubmission : onClose;

  return (
    <ModalShell
      open
      onClose={closeOrCancel}
      disableClose={submitting && !canCancelSubmission}
      title={item.entry.name}
      headerContent={<PluginModalHeader icon={icon} name={item.entry.name} />}
      sizeClassName="max-w-[480px] h-[520px] max-h-[85vh]"
      bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden p-0"
      telemetryBlocked
    >
      <PluginDetailTabs activeTab={activeTab} onSetTab={setActiveTab} />

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {activeTab === "configure" ? (
          <PluginConfigureTab
            canShare={canShare}
            canCancelSubmission={canCancelSubmission}
            canSubmit={canSubmit}
            cancelingSubmission={cancelingSubmission}
            disabledOnSurface={disabledOnSurface}
            draft={draft}
            error={error}
            item={item}
            mode={mode}
            primaryLabel={primaryLabel}
            shareOrganizationName={shareOrganizationName}
            submitting={submitting}
            surface={surface}
            onClose={onClose}
            onCancelSubmission={onCancelSubmission}
            onDraftSecretChange={onDraftSecretChange}
            onDraftSettingsChange={onDraftSettingsChange}
            onOpenDesktop={onOpenDesktop}
            onOpenDocs={onOpenDocs}
            onRequestDelete={onRequestDelete}
            onShareChange={onShareChange}
            onSubmit={onSubmit}
            onToggleEnabled={onToggleEnabled}
          />
        ) : null}
        {activeTab === "tools" ? <PluginToolsTab item={item} /> : null}
        {activeTab === "about" ? (
          <PluginAboutTab item={item} onOpenDocs={onOpenDocs} />
        ) : null}
      </div>
    </ModalShell>
  );
}

function PluginModalHeader({
  icon,
  name,
}: {
  icon: ReactNode;
  name: string;
}) {
  return (
    <div className="flex items-center gap-3">
      {icon}
      <span className="truncate text-base font-medium tracking-tight">{name}</span>
    </div>
  );
}
