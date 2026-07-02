import type { ToolCallItem } from "@anyharness/sdk";
import { Button } from "@proliferate/ui/primitives/Button";
import { FileTreeEntryIcon } from "@/components/workspace/files/file-icons";
import { FileText, Spinner } from "@proliferate/ui/icons";
import { ToolActionRow } from "./ToolActionRow";
import { deriveCoworkArtifactToolPresentation } from "@proliferate/product-domain/chats/tools/cowork-artifact-tool-presentation";

interface CoworkArtifactToolActionRowProps {
  item: ToolCallItem;
  onOpenArtifact?: (artifactId: string) => void;
}

const ARTIFACT_SPINNER_COLOR =
  "color-mix(in oklab, var(--color-link-foreground) 74%, var(--color-highlight-muted) 26%)";

export function CoworkArtifactToolActionRow({
  item,
  onOpenArtifact,
}: CoworkArtifactToolActionRowProps) {
  const presentation = deriveCoworkArtifactToolPresentation(item);
  if (!presentation) {
    return null;
  }

  const status = mapStatus(item.status);
  const label = presentation.action === "create" ? "Creating artifact" : "Updating artifact";
  const chipPath = presentation.summary?.path ?? presentation.provisional.path ?? null;
  const chipBasename = chipPath?.split("/").pop() ?? chipPath ?? null;
  const canOpenArtifact = !!presentation.summary?.id && !!onOpenArtifact;

  return (
    <ToolActionRow
      icon={presentation.running ? (
        <ArtifactRunningIcon />
      ) : (
        <FileText className="size-3 text-faint" />
      )}
      label={label}
      status={status}
      hint={chipBasename && chipPath ? (
        <ArtifactChip
          basename={chipBasename}
          pathLabel={chipPath}
          onClick={
            canOpenArtifact
              ? () => onOpenArtifact?.(presentation.summary!.id)
              : undefined
          }
        />
      ) : undefined}
      expandable={false}
    />
  );
}

function ArtifactRunningIcon() {
  return (
    <span className="inline-flex size-3 items-center justify-center" style={{ color: ARTIFACT_SPINNER_COLOR }}>
      <Spinner className="size-3 opacity-80" />
    </span>
  );
}

function ArtifactChip({
  basename,
  pathLabel,
  onClick,
}: {
  basename: string;
  pathLabel: string;
  onClick?: () => void;
}) {
  const chipContent = (
    <>
      <FileTreeEntryIcon
        name={basename}
        path={pathLabel}
        kind="file"
        className="size-2.5 shrink-0 text-muted-foreground"
      />
      <span className="truncate">{basename}</span>
    </>
  );

  if (!onClick) {
    return (
      <span
        title={pathLabel}
        className="inline-flex min-w-0 max-w-full items-center gap-0.5 rounded-sm border border-border/60 bg-muted/45 px-1 py-px font-mono text-sm leading-none text-foreground/90"
      >
        {chipContent}
      </span>
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      data-chat-transcript-ignore
      title={pathLabel}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="h-auto max-w-full rounded-sm border border-border/60 bg-muted/45 px-1 py-px font-mono text-sm leading-none text-foreground/90 hover:bg-muted"
    >
      {chipContent}
    </Button>
  );
}

function mapStatus(
  status: ToolCallItem["status"],
): "running" | "completed" | "failed" {
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  return "running";
}
