import type { ConnectorCatalogEntry } from "@/lib/domain/mcp/types";

export function ConnectorToolsTab({ entry }: { entry: ConnectorCatalogEntry }) {
  if (entry.capabilities.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No capability details curated yet for {entry.name}.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        What Proliferate can do with {entry.name} during a session.
      </p>
      <ul className="space-y-2">
        {entry.capabilities.map((capability) => (
          <li
            key={capability}
            className="flex items-start gap-2 text-sm text-foreground"
          >
            <span
              aria-hidden="true"
              className="mt-[7px] size-1 shrink-0 rounded-full bg-muted-foreground/60"
            />
            <span>{capability}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
