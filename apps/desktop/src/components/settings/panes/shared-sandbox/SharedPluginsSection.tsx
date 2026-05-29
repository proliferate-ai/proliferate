import { useState } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { Badge } from "@/components/ui/Badge";
import { ModalShell } from "@/components/ui/ModalShell";
import { Plus, Search } from "@/components/ui/icons";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { ConnectorIcon } from "@/components/plugins/status/ConnectorIcon";
import type { InstalledConnectorRecord } from "@/lib/domain/mcp/types";
import { resolveConnectorStatus } from "@/lib/domain/mcp/connector-catalog-view-model";
import {
  buildConnectedPluginPresentation,
  buildPluginSharedExposurePresentation,
} from "@/lib/domain/plugins/plugin-package-view-model";

export function SharedPluginsSection({
  organizationId,
  installed,
  loading,
  isPending,
  onSetSharedExposure,
}: {
  organizationId: string;
  installed: InstalledConnectorRecord[];
  loading: boolean;
  isPending: (connectionId: string) => boolean;
  onSetSharedExposure: (record: InstalledConnectorRecord, expose: boolean) => void;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const exposed = installed.filter((record) =>
    buildPluginSharedExposurePresentation(record).hasPublicItems
  );
  const availableToExpose = installed.length - exposed.length;
  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-sm font-medium text-foreground">
          Exposed Plugins
        </h2>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          MCP servers, skills, and plugin capabilities the shared sandbox is allowed to call.
          Add from your team&apos;s library.
        </p>
      </div>
      <SettingsCard>
        {loading ? (
          <div className="p-3 text-sm text-muted-foreground">Loading plugins...</div>
        ) : installed.length === 0 ? (
          <div className="p-3 text-sm text-muted-foreground">
            No plugins are installed yet. Install personal plugins from Plugins, then expose the ones shared work can use.
          </div>
        ) : exposed.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">
            No plugins are exposed to the shared sandbox yet.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-[minmax(12rem,2fr)_minmax(8rem,1fr)_minmax(7rem,0.8fr)_6rem] gap-4 border-b border-border-light bg-foreground/5 px-5 py-3 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              <span>Plugin</span>
              <span>Contributor</span>
              <span>Type</span>
              <span className="text-right">Action</span>
            </div>
            {exposed.map((record) => (
              <SharedPluginRow
                key={record.metadata.connectionId}
                record={record}
                pending={isPending(record.metadata.connectionId)}
                onSetSharedExposure={onSetSharedExposure}
              />
            ))}
          </>
        )}
      </SettingsCard>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setModalOpen(true)}
      >
        <Plus className="size-3.5" />
        Add plugin or MCP from team library · {availableToExpose} available
      </Button>
      {modalOpen ? (
        <SharedPluginLibraryModal
          installed={installed}
          loading={loading}
          organizationId={organizationId}
          isPending={isPending}
          onClose={() => setModalOpen(false)}
          onSetSharedExposure={onSetSharedExposure}
        />
      ) : null}
    </section>
  );
}

function SharedPluginRow({
  record,
  pending,
  onSetSharedExposure,
}: {
  record: InstalledConnectorRecord;
  pending: boolean;
  onSetSharedExposure: (record: InstalledConnectorRecord, expose: boolean) => void;
}) {
  const exposure = buildPluginSharedExposurePresentation(record);
  const presentation = buildConnectedPluginPresentation(record, resolveConnectorStatus(record));
  return (
    <div className="grid grid-cols-[minmax(12rem,2fr)_minmax(8rem,1fr)_minmax(7rem,0.8fr)_6rem] items-center gap-4 border-b border-border-light px-5 py-4 last:border-b-0">
      <div className="flex min-w-0 items-center gap-3">
        <ConnectorIcon entry={record.catalogEntry} size="sm" />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">
              {record.catalogEntry.name}
            </span>
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              {pluginKindLabel(record)}
            </span>
          </div>
          <div className="mt-1 truncate text-xs text-muted-foreground">
            {presentation.capabilitySummary}
          </div>
        </div>
      </div>
      <div className="truncate text-sm text-muted-foreground">
        {pluginContributorLabel(record)}
      </div>
      <div>
        <Badge tone={sharedExposureTone(exposure.sharedCloudTone)}>
          {exposure.sharedCloudLabel}
        </Badge>
      </div>
      <div className="flex justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          loading={pending}
          onClick={() => onSetSharedExposure(record, false)}
        >
          Hide
        </Button>
      </div>
    </div>
  );
}

type SharedPluginLibraryCategory = "all" | "available" | "exposed" | "needs-setup" | "mcp" | "skills";

const SHARED_PLUGIN_LIBRARY_CATEGORIES: {
  id: SharedPluginLibraryCategory;
  label: string;
}[] = [
  { id: "all", label: "All plugins" },
  { id: "available", label: "Available" },
  { id: "exposed", label: "Exposed" },
  { id: "needs-setup", label: "Needs setup" },
  { id: "mcp", label: "MCP servers" },
  { id: "skills", label: "Skills" },
];

function SharedPluginLibraryModal({
  installed,
  loading,
  isPending,
  onClose,
  onSetSharedExposure,
}: {
  installed: InstalledConnectorRecord[];
  loading: boolean;
  organizationId: string;
  isPending: (connectionId: string) => boolean;
  onClose: () => void;
  onSetSharedExposure: (record: InstalledConnectorRecord, expose: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<SharedPluginLibraryCategory>("all");
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = installed.filter((record) =>
    sharedPluginMatchesCategory(record, category)
    && sharedPluginMatchesQuery(record, normalizedQuery)
  );
  const counts = Object.fromEntries(
    SHARED_PLUGIN_LIBRARY_CATEGORIES.map((item) => [
      item.id,
      installed.filter((record) => sharedPluginMatchesCategory(record, item.id)).length,
    ]),
  ) as Record<SharedPluginLibraryCategory, number>;
  const activeLabel = SHARED_PLUGIN_LIBRARY_CATEGORIES.find((item) => item.id === category)?.label
    ?? "All plugins";

  return (
    <ModalShell
      open
      title="Add plugin or MCP from team library"
      description="Expose installed plugins, MCP servers, and skills to shared sandbox work."
      onClose={onClose}
      sizeClassName="max-w-[920px] h-[680px] max-h-[82vh]"
      bodyClassName="flex min-h-0 flex-1 overflow-hidden p-0"
    >
      <div className="grid min-h-0 flex-1 grid-cols-[13rem_minmax(0,1fr)] overflow-hidden border-t border-border-light">
        <aside className="overflow-y-auto border-r border-border-light p-3">
          <div className="space-y-1">
            {SHARED_PLUGIN_LIBRARY_CATEGORIES.map((item) => {
              const active = item.id === category;
              return (
                <Button
                  key={item.id}
                  type="button"
                  variant="unstyled"
                  size="unstyled"
                  onClick={() => setCategory(item.id)}
                  className={`flex w-full justify-between rounded-lg px-2 py-1.5 text-left text-sm font-medium ${
                    active
                      ? "bg-foreground/10 text-foreground"
                      : "text-muted-foreground hover:bg-foreground/[0.055] hover:text-foreground"
                  }`}
                >
                  <span className="truncate">{item.label}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{counts[item.id]}</span>
                </Button>
              );
            })}
          </div>
        </aside>
        <div className="flex min-h-0 flex-col overflow-hidden">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border-light px-4 py-3">
            <h3 className="text-sm font-medium text-foreground">{activeLabel}</h3>
            <div className="relative w-72 max-w-full">
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search plugins..."
                aria-label="Search shared plugin library"
                className="pl-9"
              />
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {loading ? (
              <div className="text-sm text-muted-foreground">Loading plugins...</div>
            ) : installed.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border-light p-4 text-sm text-muted-foreground">
                No installed plugins are available. Install plugins from the Plugins page first.
              </div>
            ) : filtered.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border-light p-4 text-sm text-muted-foreground">
                No plugins match this view.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {filtered.map((record) => (
                  <SharedPluginLibraryCard
                    key={record.metadata.connectionId}
                    record={record}
                    pending={isPending(record.metadata.connectionId)}
                    onSetSharedExposure={onSetSharedExposure}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

function SharedPluginLibraryCard({
  record,
  pending,
  onSetSharedExposure,
}: {
  record: InstalledConnectorRecord;
  pending: boolean;
  onSetSharedExposure: (record: InstalledConnectorRecord, expose: boolean) => void;
}) {
  const exposure = buildPluginSharedExposurePresentation(record);
  const status = resolveConnectorStatus(record);
  const presentation = buildConnectedPluginPresentation(record, status);
  const exposed = exposure.hasPublicItems;
  return (
    <article className="flex min-h-32 flex-col justify-between rounded-xl border border-border bg-surface-elevated-secondary p-4 transition-colors hover:bg-list-hover">
      <div className="flex min-w-0 gap-3">
        <ConnectorIcon entry={record.catalogEntry} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">
              {record.catalogEntry.name}
            </span>
            <Badge tone={status.actionable ? "warning" : "neutral"}>
              {status.label}
            </Badge>
          </div>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
            {record.catalogEntry.oneLiner}
          </p>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="min-w-0 truncate text-xs text-muted-foreground">
          {presentation.capabilitySummary} · {pluginContributorLabel(record)}
        </div>
        <Button
          type="button"
          variant={exposed ? "ghost" : "secondary"}
          size="sm"
          loading={pending}
          onClick={() => onSetSharedExposure(record, !exposed)}
        >
          {exposed ? "Hide" : "Expose"}
        </Button>
      </div>
    </article>
  );
}

function sharedPluginMatchesQuery(
  record: InstalledConnectorRecord,
  normalizedQuery: string,
): boolean {
  if (!normalizedQuery) {
    return true;
  }
  const haystack = [
    record.catalogEntry.name,
    record.catalogEntry.oneLiner,
    record.catalogEntry.description,
    record.catalogEntry.serverNameBase,
    pluginContributorLabel(record),
  ].join(" ").toLowerCase();
  return haystack.includes(normalizedQuery);
}

function sharedPluginMatchesCategory(
  record: InstalledConnectorRecord,
  category: SharedPluginLibraryCategory,
): boolean {
  const exposure = buildPluginSharedExposurePresentation(record);
  if (category === "all") {
    return true;
  }
  if (category === "available") {
    return !exposure.hasPublicItems;
  }
  if (category === "exposed") {
    return exposure.hasPublicItems;
  }
  if (category === "needs-setup") {
    return resolveConnectorStatus(record).actionable;
  }
  if (category === "mcp") {
    return true;
  }
  return (record.catalogEntry.pluginPackage?.skills.length ?? 0) > 0;
}

function pluginContributorLabel(record: InstalledConnectorRecord): string {
  if (record.metadata.ownerScope === "organization") {
    return "Organization";
  }
  if (record.metadata.ownerUserId) {
    return "Member";
  }
  return "Personal";
}

function pluginKindLabel(record: InstalledConnectorRecord): string {
  return (record.catalogEntry.pluginPackage?.skills.length ?? 0) > 0
    ? "MCP + skills"
    : "MCP";
}

function sharedExposureTone(
  tone: ReturnType<typeof buildPluginSharedExposurePresentation>["sharedCloudTone"],
) {
  if (tone === "success") {
    return "success";
  }
  if (tone === "warning") {
    return "warning";
  }
  return "neutral";
}
