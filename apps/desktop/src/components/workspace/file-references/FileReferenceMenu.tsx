import { FilePathContextMenuContent } from "@/components/workspace/open-target/FilePathContextMenuContent";
import { POPOVER_FRAME_CLASS } from "@proliferate/ui/primitives/PopoverButton";
import type { useFileReferenceActions } from "@/hooks/workspaces/files/use-file-reference-actions";

type FileReferenceActions = ReturnType<typeof useFileReferenceActions>;

export const FILE_REFERENCE_MENU_CLASS =
  `w-56 ${POPOVER_FRAME_CLASS} flex select-none flex-col overflow-visible p-1`;

export function FileReferenceMenuContent({
  actions,
  close,
}: {
  actions: FileReferenceActions;
  close: () => void;
}) {
  const openTargets = filterFileReferenceOpenTargets(actions.openTargets);

  return (
    <FilePathContextMenuContent
      canOpen={actions.canOpenExternal}
      targets={openTargets}
      defaultTarget={actions.defaultOpenTarget}
      close={close}
      onOpenDefault={() => void actions.openDefault()}
      onOpenTarget={(targetId) => void actions.openWithTarget(targetId)}
      onCopyPath={() => void actions.copyPath()}
      onRevealInFinder={() => void actions.reveal()}
      ignoreChatTranscript
    />
  );
}

function filterFileReferenceOpenTargets(
  targets: FileReferenceActions["openTargets"],
) {
  return targets.filter((target) => target.id !== "copy-path");
}
