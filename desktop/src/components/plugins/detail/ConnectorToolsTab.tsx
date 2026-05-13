import type { ConnectorCatalogEntry } from "@/lib/domain/mcp/types";
import { buildAvailablePluginPresentation } from "@/lib/domain/plugins/plugin-package-view-model";
import { Blocks, FileText, Sparkles } from "@/components/ui/icons";

export function ConnectorToolsTab({ entry }: { entry: ConnectorCatalogEntry }) {
  const presentation = buildAvailablePluginPresentation(entry);
  const skills = entry.pluginPackage?.skills ?? [];
  if (entry.capabilities.length === 0 && skills.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No MCP tool or skill details curated yet for {entry.name}.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Includes
        </div>
        <ul className="grid gap-2 sm:grid-cols-2">
          {presentation.components.map((component) => (
            <li
              key={`${component.kind}:${component.label}`}
              className="rounded-lg border border-border/50 bg-background px-3 py-2"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate text-sm text-foreground">
                  {component.label}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {component.stateLabel}
                </span>
              </div>
              <p className="line-clamp-2 pt-1 text-xs text-muted-foreground">
                {component.description}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Blocks className="size-3.5" />
          Capabilities
        </div>
        {entry.capabilities.length > 0 ? (
          <ul className="overflow-hidden rounded-lg border border-border/50 bg-background divide-y divide-border/50">
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
          <p className="rounded-lg border border-border/50 bg-background px-3 py-3 text-sm text-muted-foreground">
            No capability descriptions are curated yet.
          </p>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <FileText className="size-3.5" />
          Skills
        </div>
        {skills.length > 0 ? (
          <ul className="overflow-hidden rounded-lg border border-border/50 bg-background divide-y divide-border/50">
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
          <p className="rounded-lg border border-border/50 bg-background px-3 py-3 text-sm text-muted-foreground">
            This package contributes MCP capabilities only.
          </p>
        )}
      </section>
    </div>
  );
}
