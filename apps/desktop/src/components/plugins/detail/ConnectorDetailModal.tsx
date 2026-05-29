import type {
  ConnectorModalTab,
  ResolvedConnectorModal,
} from "@/lib/domain/mcp/connector-catalog-view-model";
import {
  buildAvailablePluginPresentation,
  buildConnectedPluginPresentation,
} from "@/lib/domain/plugins/plugin-package-view-model";
import type { ConnectorDetailCallbacks } from "@/hooks/mcp/workflows/use-connector-detail-actions";
import { useConnectorDetailActions } from "@/hooks/mcp/workflows/use-connector-detail-actions";
import { ModalShell } from "@proliferate/ui/primitives/ModalShell";
import { ConnectorAboutTab } from "./ConnectorAboutTab";
import { ConnectorConfigureTab } from "./ConnectorConfigureTab";
import { ConnectorDetailHeader } from "./ConnectorDetailHeader";
import { ConnectorDetailTabs } from "./ConnectorDetailTabs";
import { ConnectorPrimaryAction } from "./ConnectorPrimaryAction";
import { ConnectorToolsTab } from "./ConnectorToolsTab";

export function ConnectorDetailModal({
  callbacks,
  modal,
  onClose,
  onSetTab,
}: {
  callbacks: ConnectorDetailCallbacks;
  modal: ResolvedConnectorModal;
  onClose: () => void;
  onSetTab: (tab: ConnectorModalTab) => void;
}) {
  const detail = useConnectorDetailActions({
    callbacks,
    modal,
    onClose,
  });
  const pluginPresentation = modal.kind === "manage"
    ? buildConnectedPluginPresentation(modal.record, modal.status)
    : buildAvailablePluginPresentation(modal.entry);

  const primaryAction = modal.tab !== "configure"
    ? null
    : (
      <ConnectorPrimaryAction
        onCancelOAuth={() => { void detail.handleCancelOAuth(); }}
        onPrimaryAction={() => { void detail.handlePrimaryAction(); }}
        primary={detail.primary}
        reconnecting={detail.reconnecting}
        submitting={detail.submitting}
      />
    );

  return (
    <ModalShell
      open
      onClose={detail.handleClose}
      disableClose={detail.submitting}
      sizeClassName="max-w-[480px] h-[520px] max-h-[85vh]"
      bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden p-0"
      title={<ConnectorDetailHeader entry={detail.entry} />}
    >
      <ConnectorDetailTabs activeTab={modal.tab} onSetTab={onSetTab} />

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {modal.tab === "configure" && (
          <ConnectorConfigureTab
            disabled={detail.submitting || detail.reconnecting}
            entry={detail.entry}
            error={detail.error}
            focus={detail.focus}
            isConnected={detail.isConnected}
            onSecretChange={detail.onSecretChange}
            onSettingsChange={detail.onSettingsChange}
            primaryAction={primaryAction}
            secretValues={detail.secretValues}
            settings={detail.settings}
            status={detail.status}
            variant={detail.variant}
          />
        )}
        {modal.tab === "tools" && (
          <ConnectorToolsTab entry={detail.entry} presentation={pluginPresentation} />
        )}
        {modal.tab === "about" && <ConnectorAboutTab entry={detail.entry} />}
      </div>
    </ModalShell>
  );
}
