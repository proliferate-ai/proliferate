import {
  AlertCircle,
  Check,
  ExternalLink,
  Laptop,
  Search,
  Trash2,
} from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
  type SVGProps,
} from "react";
import type {
  PluginCatalogFieldView,
  PluginConnectionDraft,
  PluginConnectionStatusTone,
  PluginCatalogEntryView,
  PluginInventoryItem,
  PluginSettingValue,
  PluginSettings,
  PluginSettingsFieldView,
  PluginSurfaceKind,
} from "@proliferate/product-domain/plugins/cloud-plugin-inventory";
import {
  Blocks,
  Calendar,
  FileText,
  Folder,
  GitHub,
  Globe,
  Mail,
  MessageSquare,
  Plus,
  Search as ProductSearch,
  Sparkles,
  Sun,
  Terminal,
} from "@proliferate/ui/icons";
import { Badge, type BadgeTone } from "@proliferate/ui/primitives/Badge";
import { Button } from "@proliferate/ui/primitives/Button";
import { ConfirmationDialog } from "@proliferate/ui/primitives/ConfirmationDialog";
import { Input } from "@proliferate/ui/primitives/Input";
import { Label } from "@proliferate/ui/primitives/Label";
import { ModalShell } from "@proliferate/ui/primitives/ModalShell";
import { Select } from "@proliferate/ui/primitives/Select";
import { Switch } from "@proliferate/ui/primitives/Switch";
import { ProductNotice } from "../layout/ProductNotice";
import { PLUGIN_BRAND_ASSETS, type PluginBrandAsset } from "./plugin-brand-assets";

export type PluginModalMode = "connect" | "manage";
export type PluginModalTab = "configure" | "tools" | "about";
export type PluginIconSize = "sm" | "md";
export type PluginIconRenderer = (item: PluginInventoryItem, size: PluginIconSize) => ReactNode;

export interface PluginsSurfaceProps {
  items: readonly PluginInventoryItem[];
  query: string;
  loading: boolean;
  error: string | null;
  surface: PluginSurfaceKind;
  selectedItem: PluginInventoryItem | null;
  modalMode: PluginModalMode;
  draft: PluginConnectionDraft | null;
  submitting: boolean;
  pendingItemIds: readonly string[];
  modalError: string | null;
  completionNotice: PluginCompletionNotice | null;
  canShare: boolean;
  canCancelSubmission: boolean;
  cancelingSubmission: boolean;
  shareOrganizationName: string | null;
  deleteTarget: PluginInventoryItem | null;
  deletePending: boolean;
  renderIcon?: PluginIconRenderer;
  onQueryChange: (query: string) => void;
  onRetry: () => void;
  onOpenItem: (item: PluginInventoryItem, mode: PluginModalMode) => void;
  onCloseItem: () => void;
  onCancelSubmission: () => void;
  onDraftSettingsChange: (settings: PluginSettings | undefined) => void;
  onDraftSecretChange: (fieldId: string, value: string) => void;
  onSubmitSelected: () => void;
  onToggleEnabled: (item: PluginInventoryItem, enabled: boolean) => void;
  onShareChange: (item: PluginInventoryItem, publicToOrg: boolean) => void;
  onOpenDocs: (url: string) => void;
  onOpenDesktop: () => void;
  onRequestDelete: (item: PluginInventoryItem) => void;
  onCloseDelete: () => void;
  onConfirmDelete: () => void;
}

export interface PluginCompletionNotice {
  title: string;
  description: string;
  tone: "info" | "warning" | "destructive";
}

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
              placeholder="Search plugins..."
              className="pl-9"
              aria-label="Search plugins"
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

        {loading && items.length === 0 ? <PluginListMessage title="Loading plugins" /> : null}

        {error && items.length === 0 ? (
          <PluginListMessage
            title="Couldn't load plugins"
            description={error}
            action={<Button variant="outline" onClick={onRetry}>Retry</Button>}
          />
        ) : null}

        {searchEmpty ? (
          <PluginListMessage
            title={`No plugins match "${query}"`}
            description="Try a different search term."
          />
        ) : null}

        {!loading && !error && firstRunEmpty && available.length > 0 ? (
          <div className="rounded-lg border border-border/50 bg-foreground/5 px-4 py-3">
            <div className="text-sm font-medium text-foreground">No plugins installed</div>
            <p className="mt-1 text-sm text-muted-foreground">
              Install a package below. Enabled packages add MCP tools and plugin skills to your sessions.
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
            {installed.length > 0 ? "All available plugins are installed." : "No plugins are available right now."}
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
        title={deleteTarget ? `Delete ${deleteTarget.entry.name}?` : "Delete plugin?"}
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

function PluginSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="border-b border-border/60 pb-2">
        <h2 className="text-xs font-medium uppercase text-muted-foreground">{title}</h2>
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {children}
      </div>
    </section>
  );
}

function PluginCard({
  item,
  pending,
  renderIcon,
  onOpen,
  onToggle,
  onConfigure,
  onOpenDesktop,
}: {
  item: PluginInventoryItem;
  pending: boolean;
  renderIcon?: PluginIconRenderer;
  onOpen: () => void;
  onToggle: (enabled: boolean) => void;
  onConfigure: () => void;
  onOpenDesktop: () => void;
}) {
  const disabledOnSurface = Boolean(item.unavailableReason);
  const statusTone = badgeTone(item.statusTone);
  const icon = renderIcon?.(item, "sm") ?? <PluginGlyph item={item} size="sm" />;

  return (
    <article className="group/plugin flex min-h-[96px] flex-col gap-2 rounded-lg border border-border/60 bg-foreground/5 p-3 transition-colors hover:bg-foreground/[0.075]">
      <div className="flex min-w-0 items-start gap-3">
        <Button
          type="button"
          variant="unstyled"
          size="unstyled"
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-start gap-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {icon}
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-medium text-foreground">{item.entry.name}</span>
              <Badge tone={statusTone} className="shrink-0">
                {item.statusLabel}
              </Badge>
            </span>
            <span className="line-clamp-1 text-xs leading-5 text-muted-foreground">
              {item.entry.oneLiner}
            </span>
          </span>
        </Button>
      </div>

      <div className="flex min-w-0 items-center gap-2 pl-11">
        <div className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground/80">
          {item.capabilitySummary}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {item.state === "installed" ? (
            item.statusActionLabel ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                loading={pending}
                onClick={onConfigure}
                className="h-7 px-2 text-[11px]"
              >
                {item.statusActionLabel}
              </Button>
            ) : (
              <Switch
                checked={item.enabled}
                disabled={pending}
                onChange={onToggle}
                size="compact"
                aria-label={`${item.enabled ? "Disable" : "Enable"} ${item.entry.name}`}
              />
            )
          ) : disabledOnSurface ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onOpenDesktop}
              className="h-7 px-2 text-[11px]"
            >
              Open Desktop
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="icon"
              loading={pending}
              onClick={onConfigure}
              className="size-7 shrink-0 rounded-md"
              aria-label={`Install ${item.entry.name}`}
              title={`Install ${item.entry.name}`}
            >
              <Plus className="size-3.5" />
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}

function PluginConnectionModal({
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

const TAB_LABELS: Record<PluginModalTab, string> = {
  configure: "Configure",
  tools: "Tools",
  about: "About",
};

const MODAL_TABS: readonly PluginModalTab[] = ["configure", "tools", "about"];

function PluginDetailTabs({
  activeTab,
  onSetTab,
}: {
  activeTab: PluginModalTab;
  onSetTab: (tab: PluginModalTab) => void;
}) {
  return (
    <div
      role="tablist"
      aria-orientation="horizontal"
      className="flex shrink-0 gap-4 border-b border-border/60 px-5"
    >
      {MODAL_TABS.map((tab) => {
        const isActive = activeTab === tab;
        return (
          <Button
            key={tab}
            type="button"
            role="tab"
            aria-selected={isActive}
            variant="unstyled"
            size="unstyled"
            onClick={() => onSetTab(tab)}
            className={`-mb-px border-b-[1.5px] py-2 text-sm font-medium transition-colors ${
              isActive
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {TAB_LABELS[tab]}
          </Button>
        );
      })}
    </div>
  );
}

function PluginConfigureTab({
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

function PluginToolsTab({ item }: { item: PluginInventoryItem }) {
  const skills = item.entry.pluginPackage?.skills ?? [];
  const components = pluginComponentRows(item);

  if (item.entry.capabilities.length === 0 && skills.length === 0 && components.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No MCP tool or skill details curated yet for {item.entry.name}.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {components.length > 0 ? (
        <section className="space-y-2">
          <div className="text-xs font-medium uppercase text-muted-foreground">Includes</div>
          <ul className="grid gap-2 sm:grid-cols-2">
            {components.map((component) => (
              <li
                key={component.key}
                className="rounded-lg border border-border/50 bg-surface-control px-3 py-2"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-sm text-foreground">
                    {component.label}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {component.publicLabel && component.publicTone ? (
                      <span
                        className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${PUBLIC_TONE_CLASSES[component.publicTone]}`}
                      >
                        {component.publicLabel}
                      </span>
                    ) : null}
                    <span className="text-xs text-muted-foreground">{component.stateLabel}</span>
                  </span>
                </div>
                {component.description ? (
                  <p className="line-clamp-2 pt-1 text-xs text-muted-foreground">
                    {component.description}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <PluginCapabilityList entry={item.entry} />
      <PluginSkillList entry={item.entry} />
    </div>
  );
}

type PluginComponentTone = "neutral" | "success" | "warning" | "muted";

interface PluginComponentRow {
  key: string;
  label: string;
  description: string;
  stateLabel: string;
  publicLabel?: string;
  publicTone?: PluginComponentTone;
}

const PUBLIC_TONE_CLASSES: Record<PluginComponentTone, string> = {
  neutral: "border-border/50 text-muted-foreground",
  success: "border-success/25 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/10 text-warning",
  muted: "border-border/50 bg-muted/30 text-muted-foreground",
};

function pluginComponentRows(item: PluginInventoryItem): PluginComponentRow[] {
  const skillItemsBySkillId = new Map(
    item.configuredSkills.map((skill) => [skill.skillId, skill]),
  );
  const rows: PluginComponentRow[] = [
    {
      key: "app",
      label: `${item.entry.name} connection`,
      description: "Account, token, or local setup used by plugin capabilities.",
      stateLabel: pluginConnectionStateLabel(item),
      ...publicChip(item.connection),
    },
    {
      key: "mcp",
      label: item.entry.serverNameBase,
      description: "MCP tools mounted into compatible sessions.",
      stateLabel: pluginCapabilityStateLabel(item, item.connection?.enabled),
      ...publicChip(item.connection),
    },
  ];

  for (const skill of item.entry.pluginPackage?.skills ?? []) {
    const configuredSkill = skillItemsBySkillId.get(skill.id);
    rows.push({
      key: `skill:${skill.id}`,
      label: skill.displayName,
      description: skill.description || "Reviewed markdown instructions agents can activate when relevant.",
      stateLabel: pluginCapabilityStateLabel(item, configuredSkill?.enabled),
      ...publicChip(configuredSkill),
    });
  }

  rows.push({
    key: "requirement",
    label: runtimeRequirementLabel(item.entry),
    description: "Target-side runtime requirement for this plugin.",
    stateLabel: item.entry.availability === "cloud_only" ? "Cloud" : "Target",
  });

  return rows;
}

function pluginConnectionStateLabel(item: PluginInventoryItem): string {
  if (item.state === "available") {
    return setupLabel(item.entry);
  }
  if (item.broken || item.statusActionLabel) {
    return item.statusLabel;
  }
  return "Connected";
}

function pluginCapabilityStateLabel(
  item: PluginInventoryItem,
  enabled: boolean | undefined,
): string {
  if (item.state === "available") {
    return "After setup";
  }
  if (enabled === false) {
    return "Off";
  }
  return "Enabled";
}

function publicChip(
  item: { ownerScope: string; publicToOrg: boolean; publicStatus: string } | null | undefined,
): Pick<PluginComponentRow, "publicLabel" | "publicTone"> {
  if (!item) {
    return {};
  }
  if (item.ownerScope === "organization" || (item.publicToOrg && item.publicStatus === "public")) {
    return { publicLabel: "Shared", publicTone: "success" };
  }
  if (item.publicToOrg) {
    return { publicLabel: "Sharing", publicTone: "warning" };
  }
  return {};
}

function setupLabel(entry: PluginCatalogEntryView): string {
  if (entry.setupKind === "local_oauth") {
    return "Needs local auth";
  }
  if (entry.transport === "http" && entry.authKind === "oauth") {
    return "Needs OAuth";
  }
  if (
    entry.transport === "http"
    && (entry.authKind === "secret" || entry.requiredFields.length > 0)
  ) {
    return "Needs token";
  }
  return "No setup";
}

function runtimeRequirementLabel(entry: PluginCatalogEntryView): string {
  if (entry.transport === "stdio") {
    return "Local process";
  }
  if (entry.availability === "cloud_only") {
    return "Cloud runtime";
  }
  return "HTTP runtime";
}

function PluginAboutTab({
  item,
  onOpenDocs,
}: {
  item: PluginInventoryItem;
  onOpenDocs: (url: string) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-foreground/90">{item.entry.description}</p>

      <dl className="overflow-hidden rounded-lg border border-border/50 bg-surface-elevated-secondary text-xs divide-y divide-border/50">
        <PluginAboutRow label="Auth" value={pluginAuthLabel(item.entry)} />
        <PluginAboutRow label="Where it works" value={pluginAvailabilityLabel(item.entry)} />
        <PluginAboutRow label="Endpoint" value={item.entry.displayUrl} />
      </dl>

      <div className="flex items-center justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onOpenDocs(item.entry.docsUrl)}
        >
          Open docs
          <ExternalLink size={12} />
        </Button>
      </div>
    </div>
  );
}

function PluginCapabilityList({ entry }: { entry: PluginCatalogEntryView }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
        <Blocks className="size-3.5" />
        Capabilities
      </div>
      {entry.capabilities.length > 0 ? (
        <ul className="overflow-hidden rounded-lg border border-border/50 bg-surface-elevated-secondary divide-y divide-border/50">
          {entry.capabilities.map((capability) => (
            <li
              key={capability}
              className="flex min-h-14 items-center gap-3 px-3 py-2"
            >
              <span
                aria-hidden="true"
                className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border/60 text-muted-foreground"
              >
                <Sparkles className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="line-clamp-2 text-sm text-foreground">{capability}</span>
                <span className="block text-xs text-muted-foreground">
                  {entry.serverNameBase}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-border/50 bg-surface-elevated-secondary px-3 py-3 text-sm text-muted-foreground">
          No capability descriptions are curated yet.
        </p>
      )}
    </section>
  );
}

function PluginSkillList({ entry }: { entry: PluginCatalogEntryView }) {
  const skills = entry.pluginPackage?.skills ?? [];
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
        <FileText className="size-3.5" />
        Skills
      </div>
      {skills.length > 0 ? (
        <ul className="overflow-hidden rounded-lg border border-border/50 bg-surface-elevated-secondary divide-y divide-border/50">
          {skills.map((skill) => (
            <li
              key={skill.id}
              className="flex min-h-14 items-center gap-3 px-3 py-2"
            >
              <span
                aria-hidden="true"
                className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border/60 text-muted-foreground"
              >
                <FileText className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="line-clamp-1 text-sm text-foreground">
                  {skill.displayName}
                </span>
                <span className="line-clamp-2 text-xs text-muted-foreground">
                  {skill.description}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-border/50 bg-surface-elevated-secondary px-3 py-3 text-sm text-muted-foreground">
          This package contributes MCP capabilities only.
        </p>
      )}
    </section>
  );
}

function PluginAboutRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="grid min-h-12 items-center gap-1 px-4 py-2 sm:grid-cols-[128px_minmax(0,1fr)]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-all text-foreground sm:text-right">{value}</dd>
    </div>
  );
}

function pluginAuthLabel(entry: PluginCatalogEntryView): string {
  if (entry.transport === "http" && entry.authKind === "oauth") {
    return "OAuth";
  }
  if (entry.transport === "http" && entry.authKind === "secret") {
    return "API key";
  }
  return "No credentials";
}

function pluginAvailabilityLabel(entry: PluginCatalogEntryView): string {
  switch (entry.availability) {
    case "universal":
      return "Local + Cloud";
    case "local_only":
      return "Local only";
    case "cloud_only":
      return "Cloud only";
  }
}

function PluginSettingsFields({
  fields,
  helperText,
  settings,
  disabled,
  onChange,
}: {
  fields: readonly PluginSettingsFieldView[];
  helperText?: string;
  settings: PluginSettings | undefined;
  disabled: boolean;
  onChange: (settings: PluginSettings | undefined) => void;
}) {
  if (fields.length === 0) {
    return null;
  }

  function setValue(field: PluginSettingsFieldView, value: PluginSettingValue) {
    onChange({
      ...(settings ?? {}),
      [field.id]: value,
    });
  }

  return (
    <div className="space-y-3">
      <div className="text-xs font-medium uppercase text-muted-foreground">Configuration</div>
      {helperText ? <p className="text-xs text-muted-foreground">{helperText}</p> : null}
      {fields.map((field) => (
        <div key={field.id}>
          <Label htmlFor={`plugin-setting-${field.id}`}>{field.label}</Label>
          {field.kind === "boolean" ? (
            <Switch
              id={`plugin-setting-${field.id}`}
              checked={Boolean(settings?.[field.id])}
              disabled={disabled}
              onChange={(checked) => setValue(field, checked)}
            />
          ) : field.kind === "select" ? (
            <Select
              id={`plugin-setting-${field.id}`}
              value={String(settings?.[field.id] ?? "")}
              disabled={disabled}
              onChange={(event) => setValue(field, event.target.value)}
            >
              <option value="" disabled>
                Select {field.label}
              </option>
              {field.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          ) : (
            <Input
              id={`plugin-setting-${field.id}`}
              value={String(settings?.[field.id] ?? "")}
              placeholder={field.placeholder}
              disabled={disabled}
              onChange={(event) => setValue(field, event.target.value)}
            />
          )}
          {field.helperText ? (
            <p className="mt-1 text-xs text-muted-foreground">{field.helperText}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function PluginSecretFields({
  autoFocus,
  item,
  draft,
  mode,
  disabled,
  onChange,
  onOpenDocs,
}: {
  autoFocus: boolean;
  item: PluginInventoryItem;
  draft: PluginConnectionDraft;
  mode: PluginModalMode;
  disabled: boolean;
  onChange: (fieldId: string, value: string) => void;
  onOpenDocs: (url: string) => void;
}) {
  const fields = item.entry.secretFields.length > 0
    ? item.entry.secretFields
    : item.entry.requiredFields;
  if (fields.length === 0 || item.entry.authKind === "oauth") {
    return null;
  }

  return (
    <div className="space-y-3">
      <div className="text-xs font-medium uppercase text-muted-foreground">
        {mode === "manage" ? "Replace token" : "Token"}
      </div>
      {fields.map((field, index) => (
        <PluginSecretFieldInput
          key={field.id}
          autoFocus={autoFocus && index === 0}
          disabled={disabled}
          docsUrl={item.entry.docsUrl}
          field={field}
          value={draft.secretFields[field.id] ?? ""}
          onChange={(value) => onChange(field.id, value)}
          onOpenDocs={onOpenDocs}
        />
      ))}
    </div>
  );
}

function PluginSecretFieldInput({
  autoFocus,
  disabled,
  docsUrl,
  field,
  onChange,
  onOpenDocs,
  value,
}: {
  autoFocus: boolean;
  disabled: boolean;
  docsUrl: string;
  field: PluginCatalogFieldView;
  onChange: (value: string) => void;
  onOpenDocs: (url: string) => void;
  value: string;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [visible, setVisible] = useState(false);
  const hint = pluginFieldPrefixHint(field, value);

  useEffect(() => {
    if (autoFocus) {
      inputRef.current?.focus();
    }
  }, [autoFocus]);

  return (
    <div className="space-y-2">
      <div>
        <Label htmlFor={inputId}>{field.label}</Label>
        <div className="flex items-center gap-2">
          <Input
            ref={inputRef}
            id={inputId}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={field.placeholder}
            type={visible ? "text" : "password"}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            disabled={disabled}
            data-telemetry-mask
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setVisible((current) => !current)}
            disabled={disabled}
          >
            {visible ? "Hide" : "Show"}
          </Button>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{field.helperText}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onOpenDocs(docsUrl)}
          disabled={disabled}
        >
          Get token
          <ExternalLink size={12} />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{field.getTokenInstructions}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function pluginFieldPrefixHint(field: PluginCatalogFieldView, value: string): string | null {
  const normalized = value.trim();
  if (!field.prefixHint || !normalized || normalized.startsWith(field.prefixHint)) {
    return null;
  }
  return `Usually starts with ${field.prefixHint}`;
}

type PluginGlyphIcon = ComponentType<SVGProps<SVGSVGElement>>;

function LinearGlyph({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="currentColor"
      viewBox="0 0 100 100"
      className={className}
      {...props}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M1.22541 61.5228c-.2225-.9485.90748-1.5459 1.59638-.857L39.3342 97.1782c.6889.6889.0915 1.8189-.857 1.5964C20.0515 94.4522 5.54779 79.9485 1.22541 61.5228ZM.00189135 46.8891c-.01764375.2833.08887215.5599.28957165.7606L52.3503 99.7085c.2007.2007.4773.3075.7606.2896 2.3692-.1476 4.6938-.46 6.9624-.9259.7645-.157 1.0301-1.0963.4782-1.6481L2.57595 39.4485c-.55186-.5519-1.49117-.2863-1.648174.4782-.465915 2.2686-.77832 4.5932-.92588465 6.9624ZM4.21093 29.7054c-.16649.3738-.08169.8106.20765 1.1l64.77602 64.776c.2894.2894.7262.3742 1.1.2077 1.7861-.7956 3.5171-1.6927 5.1855-2.684.5521-.328.6373-1.0867.1832-1.5407L8.43566 24.3367c-.45409-.4541-1.21271-.3689-1.54074.1832-.99132 1.6684-1.88843 3.3994-2.68399 5.1855ZM12.6587 18.074c-.3701-.3701-.393-.9637-.0443-1.3541C21.7795 6.45931 35.1114 0 49.9519 0 77.5927 0 100 22.4073 100 50.0481c0 14.8405-6.4593 28.1724-16.7199 37.3375-.3903.3487-.984.3258-1.3542-.0443L12.6587 18.074Z"
      />
    </svg>
  );
}

function TavilyGlyph({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="currentColor"
      viewBox="0 0 56 56"
      className={className}
      {...props}
    >
      <path d="M39.5137 0C45.2842 0 48.17 0 50.374 1.12305C52.3127 2.11089 53.8892 3.68731 54.877 5.62598C55.9998 7.82995 56 10.7153 56 16.4854V39.5146C56 45.2847 55.9998 48.17 54.877 50.374C53.8891 52.3127 52.3127 53.8891 50.374 54.877C48.17 56 45.2842 56 39.5137 56H16.4854C10.7148 56 7.82905 56 5.625 54.877C3.68646 53.8891 2.11082 52.3126 1.12305 50.374C0 48.17 0 45.2849 0 39.5146V16.4854C0 10.7151 0 7.82999 1.12305 5.62598C2.11082 3.68739 3.68646 2.11089 5.625 1.12305C7.82905 0 10.7148 0 16.4854 0H39.5137ZM23.8105 30.958C23.5077 30.9581 23.2076 31.0175 22.9277 31.1338C22.6478 31.2502 22.393 31.4216 22.1787 31.6367L17.7705 36.0625L16.5986 34.8867C15.7377 34.0228 14.2649 34.4498 13.9971 35.6426L12.3271 43.0713C12.2686 43.3267 12.2752 43.593 12.3477 43.8447C12.4199 44.0956 12.555 44.3246 12.7393 44.5088L12.7383 44.5107C12.922 44.6967 13.1498 44.8324 13.4004 44.9053C13.6513 44.9782 13.9173 44.9856 14.1719 44.9268L21.5713 43.25C22.7588 42.9812 23.1851 41.502 22.3242 40.6377L21.1523 39.4619L25.5615 35.0371C25.9943 34.6025 26.2373 34.012 26.2373 33.3975C26.2372 32.783 25.9942 32.1934 25.5615 31.7588L25.5029 31.6992L25.5049 31.6982L25.4434 31.6367C25.229 31.4215 24.9744 31.2503 24.6943 31.1338C24.4144 31.0174 24.1136 30.958 23.8105 30.958ZM39.7139 28.1689C38.6842 27.5158 37.3429 28.2597 37.3428 29.4824V31.1445H27.8955C28.2111 31.7502 28.3916 32.439 28.3916 33.1699C28.3915 34.2266 28.0177 35.196 27.3965 35.9521H37.3418V37.6143C37.342 38.837 38.6843 39.58 39.7139 38.9268L46.1279 34.8613C46.6077 34.5556 46.8476 34.0509 46.8477 33.5469C46.847 33.0436 46.6067 32.5399 46.126 32.2354L39.7139 28.1689ZM24.0391 10.4062C23.778 10.4051 23.5207 10.4712 23.292 10.5977C23.063 10.7243 22.869 10.9083 22.7305 11.1309L18.6807 17.5684H18.6787C18.028 18.602 18.7694 19.9499 19.9873 19.9502H21.6436V29.5137C22.3307 29.0592 23.1537 28.794 24.0381 28.7939C24.9228 28.794 25.7453 29.0599 26.4326 29.5146V19.9502H28.0898C29.3077 19.9501 30.047 18.6028 29.3975 17.5684L25.3457 11.1309C25.0415 10.6489 24.5406 10.4068 24.0391 10.4062Z" />
    </svg>
  );
}

const PLUGIN_GLYPH_ICONS: Record<string, PluginGlyphIcon> = {
  calendar: Calendar,
  github: GitHub,
  gmail: Mail,
  globe: Globe,
  linear: LinearGlyph,
  search: ProductSearch,
  slack: MessageSquare,
  sun: Sun,
  tavily: TavilyGlyph,
  folder: Folder,
  terminal: Terminal,
};

const PLUGIN_GLYPH_TILE_SIZE: Record<PluginIconSize, string> = {
  sm: "size-8 rounded-lg",
  md: "size-10 rounded-lg",
};

const PLUGIN_GLYPH_ICON_SIZE: Record<PluginIconSize, string> = {
  sm: "size-[72%]",
  md: "size-7",
};

function PluginGlyph({
  item,
  size = "sm",
}: {
  item: PluginInventoryItem;
  size?: PluginIconSize;
}) {
  const brandAsset = PLUGIN_BRAND_ASSETS[item.entry.iconId];
  if (brandAsset) {
    return (
      <span
        aria-hidden="true"
        className={`flex shrink-0 items-center justify-center overflow-hidden border border-border/70 ${brandAsset.tileClassName ?? "bg-brand-logo-tile"} ${brandAsset.darkTileClassName ?? "dark:bg-transparent"} ${PLUGIN_GLYPH_TILE_SIZE[size]}`}
      >
        <PluginBrandImage asset={brandAsset} />
      </span>
    );
  }

  const Icon = PLUGIN_GLYPH_ICONS[item.entry.iconId] ?? Globe;
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center border border-border/70 bg-transparent text-muted-foreground ${PLUGIN_GLYPH_TILE_SIZE[size]}`}
    >
      <Icon className={`${PLUGIN_GLYPH_ICON_SIZE[size]} shrink-0`} />
    </span>
  );
}

function PluginBrandImage({ asset }: { asset: PluginBrandAsset }) {
  if (asset.darkSrc) {
    return (
      <>
        <img src={asset.src} alt="" className="size-full object-contain dark:hidden" />
        <img src={asset.darkSrc} alt="" className="hidden size-full object-contain dark:block" />
      </>
    );
  }

  return <img src={asset.src} alt="" className="size-full object-contain" />;
}

function PluginListMessage({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface-elevated-secondary px-4 py-8 text-center">
      <div className="text-sm font-medium text-foreground">{title}</div>
      {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

function primaryActionLabel(
  item: PluginInventoryItem,
  mode: PluginModalMode,
  surface: PluginSurfaceKind,
): string | null {
  if (item.unavailableReason && mode === "connect" && surface === "web") {
    return "Open Desktop";
  }
  if (mode === "manage") {
    if (item.setupVariant === "no_setup") {
      return null;
    }
    if (item.setupVariant === "oauth" || item.setupVariant === "oauth_structured") {
      return "Reconnect";
    }
    return "Save";
  }
  if (item.setupVariant === "oauth" || item.setupVariant === "oauth_structured") {
    return "Connect in browser";
  }
  return "Install";
}

function badgeTone(tone: PluginConnectionStatusTone): BadgeTone {
  switch (tone) {
    case "error":
      return "destructive";
    case "warning":
      return "warning";
    case "neutral":
      return "success";
    case "muted":
      return "neutral";
  }
}
