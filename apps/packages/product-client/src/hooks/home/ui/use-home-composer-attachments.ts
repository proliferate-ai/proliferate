import { useCallback, useMemo, useRef, useState, type DragEvent } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { useChatPromptAttachments } from "#product/hooks/chat/ui/use-chat-prompt-attachments";
import {
  isFileDrag,
  readFileDragInput,
} from "#product/lib/domain/chat/composer/prompt-attachment-drag";
import { HOME_COMPOSER_PROMPT_CAPABILITIES } from "#product/lib/domain/home/home-composer-controls";
import type { HomeLaunchTarget } from "#product/lib/domain/home/home-next-launch";

/**
 * The home screen's attachment controller plus its whole-screen drop wiring.
 *
 * Dropped-path recovery mirrors ChatView: local path references are only
 * meaningful when the launched agent will share this machine's filesystem.
 * cowork/local/worktree run here; cloud does not, and an unresolved target
 * gets no local refs either. The attachment scope keys off
 * the same split so flipping the target across the local/remote boundary
 * clears drafts instead of letting a stale local path ride into a runtime
 * that cannot read it.
 */
export function useHomeComposerAttachments(
  launchTargetKind: HomeLaunchTarget["kind"] | null,
) {
  const host = useProductHost();
  const desktopFiles = host.desktop?.files ?? null;
  const isLocalRuntimeTarget = launchTargetKind === "cowork"
    || launchTargetKind === "local"
    || launchTargetKind === "worktree";
  // One promise per drag session (see ChatView): a promise's value cannot be
  // clobbered by a later session's capture, and a drop that lands before the
  // capture resolves awaits it instead of skipping the comparison.
  const dragSessionChangeCountRef = useRef<Promise<number> | null>(null);
  const pendingDropChangeCountRef = useRef<Promise<number> | null>(null);
  const resolveDroppedPaths = useMemo(() => {
    if (!desktopFiles || !isLocalRuntimeTarget) {
      return null;
    }
    return async () => {
      const expectedChangeCount = pendingDropChangeCountRef.current;
      pendingDropChangeCountRef.current = null;
      // No captured drag session means the snapshot cannot be attributed;
      // empty entries route the drop to byte uploads.
      if (!expectedChangeCount) {
        return [];
      }
      const [snapshot, expected] = await Promise.all([
        desktopFiles.readDroppedPaths(),
        expectedChangeCount,
      ]);
      // A different drag session wrote the pasteboard after this drop's drag
      // entered the surface.
      return snapshot.changeCount === expected ? snapshot.entries : [];
    };
  }, [desktopFiles, isLocalRuntimeTarget]);
  const attachments = useChatPromptAttachments({
    scopeKey: isLocalRuntimeTarget ? "home:local" : "home:remote",
    promptCapabilities: HOME_COMPOSER_PROMPT_CAPABILITIES,
    canAttachFiles: true,
    resolveDroppedPaths,
  });
  const [fileDragOver, setFileDragOver] = useState(false);
  const addDroppedFiles = attachments.addDroppedFiles;
  const handleFileDrag = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(readFileDragInput(event.dataTransfer))) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setFileDragOver(true);
    if (dragSessionChangeCountRef.current === null && desktopFiles && resolveDroppedPaths) {
      // Arm once per drag session; the count identifies the session that
      // will deliver the drop.
      dragSessionChangeCountRef.current = desktopFiles.getDragPasteboardChangeCount();
    }
  }, [desktopFiles, resolveDroppedPaths]);
  const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(readFileDragInput(event.dataTransfer))) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setFileDragOver(false);
    const sessionChangeCount = dragSessionChangeCountRef.current;
    dragSessionChangeCountRef.current = null;
    pendingDropChangeCountRef.current = sessionChangeCount;
    // No files.length gate: WebKit can surface folder-only drops with an
    // empty FileList, and the host path resolver still recovers those items.
    addDroppedFiles(event.dataTransfer.files);
  }, [addDroppedFiles]);
  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    const relatedTarget = event.relatedTarget;
    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) {
      return;
    }
    setFileDragOver(false);
    dragSessionChangeCountRef.current = null;
  }, []);

  return {
    attachments,
    fileDragOver,
    handleFileDrag,
    handleDrop,
    handleDragLeave,
  };
}
