
import { AlertCircle, Check, Search } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { ConfirmationDialog } from "@proliferate/ui/primitives/ConfirmationDialog";
import { Input } from "@proliferate/ui/primitives/Input";
import { ProductNotice } from "../layout/ProductNotice";
import { PluginCard, PluginListMessage, PluginSection } from "./PluginCards";
import { PluginConnectionModal } from "./PluginConnectionModal";
import type { PluginsSurfaceProps } from "./plugin-types";

export type {
  PluginCompletionNotice,
  PluginIconRenderer,
  PluginIconSize,
  PluginModalMode,
  PluginModalTab,
  PluginsSurfaceProps,
} from "./plugin-types";

export function PluginsSurface({
  items,
  query,
  loading,
  error,
  surface,
  selectedItem,
  modalMode,
  draft,
  submitting,
  pendingItemIds,
  modalError,
  completionNotice,
  canShare,
  canCancelSubmission,
  cancelingSubmission,
  shareOrganizationName,
  deleteTarget,
  deletePending,
  renderIcon,
  onQueryChange,
  onRetry,
  onOpenItem,
  onCloseItem,
  onCancelSubmission,
  onDraftSettingsChange,
  onDraftSecretChange,
  onSubmitSelected,
  onToggleEnabled,
  onShareChange,
  onOpenDocs,
  onOpenDesktop,
  onRequestDelete,
  onCloseDelete,
  onConfirmDelete,
}: PluginsSurfaceProps) {
  const pendingIds = useMemo(() => new Set(pendingItemIds), [pendingItemIds]);
  const installed = items.filter((item) => item.state === "installed");
  const available = items.filter((item) => item.state === "available");
  const firstRunEmpty = !loading && !error && installed.length === 0 && !query.trim();
  const searchEmpty = !loading && !error && items.length === 0 && query.trim().length > 0;

  return (
    <>
      <section className="space-y-5">
        <div className="sticky top-10 z-10 bg-background/95 pb-2 pt-1 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Search integrations..."
              className="pl-9"
              aria-label="Search integrations"
            />
          </div>
        </div>

        {completionNotice ? (
          <ProductNotice
            tone={completionNotice.tone}
            icon={completionNotice.tone === "destructive" ? <AlertCircle size={16} /> : <Check size={16} />}
            title={completionNotice.title}
            description={completionNotice.description}
          />
        ) : null}

        {loading && items.length === 0 ? <PluginListMessage title="Loading integrations" /> : null}

        {error && items.length === 0 ? (
          <PluginListMessage
            title="Couldn't load integrations"
            description={error}
            action={<Button variant="outline" onClick={onRetry}>Retry</Button>}
          />
        ) : null}

        {searchEmpty ? (
          <PluginListMessage
            title={`No integrations match "${query}"`}
            description="Try a different search term."
          />
        ) : null}

        {!loading && !error && firstRunEmpty && available.length > 0 ? (
          <div className="rounded-lg border border-border/50 bg-foreground/5 px-4 py-3">
            <div className="text-sm font-medium text-foreground">No integrations installed</div>
            <p className="mt-1 text-sm text-muted-foreground">
              Install a package below. Enabled packages add MCP tools and skills to your sessions.
            </p>
          </div>
        ) : null}

        {installed.length > 0 ? (
          <PluginSection title="Installed">
            {installed.map((item) => (
              <PluginCard
                key={item.id}
                item={item}
                pending={pendingIds.has(item.id)}
                renderIcon={renderIcon}
                onOpen={() => onOpenItem(item, "manage")}
                onToggle={(enabled) => onToggleEnabled(item, enabled)}
                onConfigure={() => onOpenItem(item, "manage")}
                onOpenDesktop={onOpenDesktop}
              />
            ))}
          </PluginSection>
        ) : null}

        {available.length > 0 ? (
          <PluginSection title="Available">
            {available.map((item) => (
              <PluginCard
                key={item.id}
                item={item}
                pending={pendingIds.has(item.id)}
                renderIcon={renderIcon}
                onOpen={() => onOpenItem(item, "connect")}
                onToggle={(enabled) => onToggleEnabled(item, enabled)}
                onConfigure={() => onOpenItem(item, "connect")}
                onOpenDesktop={onOpenDesktop}
              />
            ))}
          </PluginSection>
        ) : !loading && !error && !searchEmpty ? (
          <p className="text-sm text-muted-foreground">
            {installed.length > 0 ? "All available integrations are installed." : "No integrations are available right now."}
          </p>
        ) : null}
      </section>

      <PluginConnectionModal
        item={selectedItem}
        mode={modalMode}
        draft={draft}
        submitting={submitting}
        error={modalError}
        surface={surface}
        canShare={canShare}
        canCancelSubmission={canCancelSubmission}
        cancelingSubmission={cancelingSubmission}
        shareOrganizationName={shareOrganizationName}
        onClose={onCloseItem}
        onCancelSubmission={onCancelSubmission}
        onDraftSettingsChange={onDraftSettingsChange}
        onDraftSecretChange={onDraftSecretChange}
        onSubmit={onSubmitSelected}
        onToggleEnabled={onToggleEnabled}
        onShareChange={onShareChange}
        onOpenDocs={onOpenDocs}
        onOpenDesktop={onOpenDesktop}
        onRequestDelete={onRequestDelete}
        renderIcon={renderIcon}
      />

      <ConfirmationDialog
        open={deleteTarget !== null}
        title={deleteTarget ? `Delete ${deleteTarget.entry.name}?` : "Delete integration?"}
        description="This removes the MCP connection from personal cloud access. Existing sessions keep their transcript history."
        confirmLabel="Delete"
        confirmVariant="destructive"
        loading={deletePending}
        disableClose={deletePending}
        onClose={onCloseDelete}
        onConfirm={onConfirmDelete}
      />
    </>
  );
}
