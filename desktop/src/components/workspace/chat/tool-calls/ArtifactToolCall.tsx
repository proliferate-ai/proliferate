import type { ToolCallItem } from "@anyharness/sdk";
import { FilePen, FilePlus, FileText } from "@/components/ui/icons";
import { getArtifactToolCallData } from "@/lib/domain/chat/artifact-tool-call";
import { ToolCallBlock } from "./ToolCallBlock";

interface ArtifactToolCallProps {
  item: ToolCallItem;
  status: "running" | "completed" | "failed";
}

export function ArtifactToolCall({
  item,
  status,
}: ArtifactToolCallProps) {
  const artifact = getArtifactToolCallData(item);
  if (!artifact) {
    return null;
  }

  const icon = artifact.action === "created"
    ? <FilePlus />
    : artifact.action === "updated"
      ? <FilePen />
      : <FileText />;
  const hint = artifact.renderer ?? "artifact";
  const hasDetails = Boolean(artifact.action || artifact.entry || artifact.artifactId);

  return (
    <ToolCallBlock
      icon={icon}
      name={<span className="font-[460] text-foreground/90">{artifact.title}</span>}
      hint={hint}
      status={status}
      expandable={hasDetails}
      defaultExpanded={status === "running"}
    >
      <div className="space-y-2 pb-1">
        {artifact.action && (
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {artifact.action}
          </div>
        )}
        {artifact.entry && (
          <div className="rounded-md border border-border/60 bg-muted/25 px-2.5 py-2 font-mono text-xs text-foreground">
            {artifact.entry}
          </div>
        )}
        {artifact.artifactId && (
          <div className="text-xs text-muted-foreground">
            id: <span className="font-mono text-foreground/85">{artifact.artifactId}</span>
          </div>
        )}
      </div>
    </ToolCallBlock>
  );
}
