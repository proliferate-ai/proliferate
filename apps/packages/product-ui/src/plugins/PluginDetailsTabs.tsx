
import { ExternalLink } from "lucide-react";
import type {
  PluginCatalogEntryView,
  PluginInventoryItem,
} from "@proliferate/product-domain/plugins/cloud-plugin-inventory";
import { Blocks, FileText, Sparkles } from "@proliferate/ui/icons";
import { Button } from "@proliferate/ui/primitives/Button";
import { PUBLIC_TONE_CLASSES, pluginComponentRows } from "./plugin-presentation";
import type { PluginModalTab } from "./plugin-types";

const TAB_LABELS: Record<PluginModalTab, string> = {
  configure: "Configure",
  tools: "Tools",
  about: "About",
};

const MODAL_TABS: readonly PluginModalTab[] = ["configure", "tools", "about"];

export function PluginDetailTabs({
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

export function PluginToolsTab({ item }: { item: PluginInventoryItem }) {
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

export function PluginAboutTab({
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
