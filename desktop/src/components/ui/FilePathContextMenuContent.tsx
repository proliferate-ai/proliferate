import { PopoverMenuItem } from "@/components/ui/PopoverMenuItem";
import { Copy, ExternalLink, FolderOpen } from "@/components/ui/icons";

export interface FilePathContextMenuTarget {
  id: string;
  label: string;
}

export function FilePathContextMenuContent({
  canOpen,
  targets,
  close,
  onOpenDefault,
  onOpenTarget,
  onCopyPath,
  onRevealInFinder,
  ignoreChatTranscript = false,
}: {
  canOpen: boolean;
  targets: readonly FilePathContextMenuTarget[];
  close: () => void;
  onOpenDefault: () => void;
  onOpenTarget: (targetId: string) => void;
  onCopyPath: () => void;
  onRevealInFinder: () => void;
  ignoreChatTranscript?: boolean;
}) {
  const transcriptProps = ignoreChatTranscript
    ? { "data-chat-transcript-ignore": true }
    : {};

  return (
    <div className="flex flex-col gap-px">
      <PopoverMenuItem
        {...transcriptProps}
        icon={<ExternalLink className="size-3.5 shrink-0" />}
        label={'Open in "Your default"'}
        disabled={!canOpen}
        onClick={() => {
          onOpenDefault();
          close();
        }}
      />
      {targets.length > 0 && (
        <PopoverMenuItem
          {...transcriptProps}
          icon={<ExternalLink className="size-3.5 shrink-0" />}
          label="Open in >"
          disabled
        />
      )}
      {targets.map((target) => (
        <PopoverMenuItem
          key={target.id}
          {...transcriptProps}
          icon={<ExternalLink className="size-3.5 shrink-0" />}
          label={target.label}
          disabled={!canOpen}
          onClick={() => {
            onOpenTarget(target.id);
            close();
          }}
        />
      ))}
      <PopoverMenuItem
        {...transcriptProps}
        icon={<Copy className="size-3.5 shrink-0" />}
        label="Copy path"
        onClick={() => {
          onCopyPath();
          close();
        }}
      />
      <PopoverMenuItem
        {...transcriptProps}
        icon={<FolderOpen className="size-3.5 shrink-0" />}
        label="Reveal in Finder"
        disabled={!canOpen}
        onClick={() => {
          onRevealInFinder();
          close();
        }}
      />
    </div>
  );
}
