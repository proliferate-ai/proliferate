import { FilePathContextMenuContent } from "#product/components/workspace/open-target/FilePathContextMenuContent";
import { POPOVER_FRAME_CLASS } from "#product/primitives/PopoverButton";
import { PopoverMenuItem } from "#product/primitives/PopoverMenuItem";
import type { useFileReferenceActions } from "#product/hooks/workspaces/workflows/files/use-file-reference-actions";

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
  if (actions.accessState.status !== "settled") {
    if (actions.copyPath === null) return null;
    return (
      <div className="relative flex flex-col gap-px">
        <PopoverMenuItem
          density="compact"
          role="menuitem"
          data-chat-transcript-ignore
          label="Copy path"
          onClick={() => {
            void actions.copyCurrentPath();
            close();
          }}
        />
      </div>
    );
  }
  const openTargets = filterFileReferenceOpenTargets(actions.openTargets);

  return (
    <FilePathContextMenuContent
      pathKind={actions.pathKind}
      canOpenInViewer={actions.canOpenInSidebar}
      canOpenExternal={actions.canOpenExternal}
      canReveal={actions.canReveal}
      targets={openTargets}
      defaultTarget={actions.defaultOpenTarget}
      close={close}
      onOpenInViewer={() => void actions.openInSidebar()}
      onOpenDefault={() => void actions.openDefault()}
      onOpenTarget={(targetId) => void actions.openWithTarget(targetId)}
      onCopyPath={() => void actions.copyCurrentPath()}
      onRevealInFinder={() => void actions.reveal()}
      ignoreChatTranscript
      hideUnavailableActions
    />
  );
}

function filterFileReferenceOpenTargets(
  targets: FileReferenceActions["openTargets"],
) {
  return targets.filter((target) => target.id !== "copy-path");
}
