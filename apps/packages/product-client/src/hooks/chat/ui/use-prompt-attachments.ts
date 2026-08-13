import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PromptCapabilities } from "@anyharness/sdk";
import {
  partitionDroppedPathCandidates,
  pasteAttachmentName,
  PROMPT_FOLDER_MIME_TYPE,
  PROMPT_TEXT_RESOURCE_MAX_BYTES,
  promptUploadKind,
  shouldCreatePasteAttachment,
  type DroppedPathCandidate,
  type LocalRefCandidate,
  type PromptAttachmentDescriptor,
} from "#product/domain/chats/composer/prompt-attachment-rules";
import {
  createPromptAttachmentSnapshot,
  type PromptAttachmentSnapshot,
} from "#product/domain/chats/composer/prompt-attachment-snapshot";

interface AttachmentEntry {
  descriptor: PromptAttachmentDescriptor;
  /** Null for local_ref attachments, which attach by path instead of bytes. */
  file: File | null;
}

const MAX_PROMPT_ATTACHMENTS = 10;

export interface PromptAttachmentLifetimeOptions {
  onBeforeReleaseAttachments?: (
    attachments: readonly PromptAttachmentDescriptor[],
  ) => void;
  /**
   * Host resolver recovering absolute local paths for the drag session that
   * just dropped. Null when paths are unavailable (web host, cloud
   * workspaces), which keeps drops on the byte-based `addFiles` behavior.
   */
  resolveDroppedPaths?: (() => Promise<DroppedPathCandidate[]>) | null;
}

function createAttachmentId(): string {
  return `attachment:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
}

function revokeAttachmentObjectUrl(entry: AttachmentEntry): void {
  if (entry.descriptor.objectUrl) {
    URL.revokeObjectURL(entry.descriptor.objectUrl);
  }
}

export function usePromptAttachments(
  scopeKey: string | null | undefined,
  capabilities: PromptCapabilities | null | undefined,
  lifetimeOptions: PromptAttachmentLifetimeOptions = {},
) {
  const canAttachImages = capabilities?.image === true;
  const canAttachEmbeddedContext = capabilities?.embeddedContext === true;
  const [entries, setEntries] = useState<AttachmentEntry[]>([]);
  const entriesRef = useRef<AttachmentEntry[]>([]);
  const onBeforeReleaseAttachmentsRef = useRef(
    lifetimeOptions.onBeforeReleaseAttachments,
  );
  const resolveDroppedPathsRef = useRef(lifetimeOptions.resolveDroppedPaths);

  useEffect(() => {
    onBeforeReleaseAttachmentsRef.current = lifetimeOptions.onBeforeReleaseAttachments;
    resolveDroppedPathsRef.current = lifetimeOptions.resolveDroppedPaths;
  }, [lifetimeOptions.onBeforeReleaseAttachments, lifetimeOptions.resolveDroppedPaths]);

  const releaseEntries = useCallback((released: readonly AttachmentEntry[]) => {
    if (released.length === 0) {
      return;
    }
    onBeforeReleaseAttachmentsRef.current?.(
      released.map((entry) => entry.descriptor),
    );
    for (const entry of released) {
      revokeAttachmentObjectUrl(entry);
    }
  }, []);

  useEffect(() => () => {
    const outgoing = entriesRef.current;
    entriesRef.current = [];
    releaseEntries(outgoing);
  }, [releaseEntries]);

  useEffect(() => {
    if (entriesRef.current.length === 0) {
      return;
    }
    const outgoing = entriesRef.current;
    entriesRef.current = [];
    setEntries([]);
    releaseEntries(outgoing);
  }, [releaseEntries, scopeKey]);

  const descriptors = useMemo(
    () => entries.map((entry) => entry.descriptor),
    [entries],
  );

  const addFiles = useCallback((files: Iterable<File>) => {
    const next: AttachmentEntry[] = [];
    let remainingSlots = Math.max(0, MAX_PROMPT_ATTACHMENTS - entriesRef.current.length);
    for (const file of files) {
      if (remainingSlots <= 0) {
        break;
      }

      const uploadKind = promptUploadKind(file, { canAttachImages, canAttachEmbeddedContext });
      if (!uploadKind) {
        continue;
      }
      const isImage = uploadKind === "image";
      next.push({
        file,
        descriptor: {
          id: createAttachmentId(),
          name: file.name || (isImage ? "image" : "file"),
          mimeType: file.type || (isImage ? "image/png" : "text/plain"),
          size: file.size,
          kind: uploadKind,
          source: "upload",
          objectUrl: URL.createObjectURL(file),
        },
      });
      remainingSlots -= 1;
    }

    if (next.length === 0) {
      return;
    }

    const updated = [...entriesRef.current, ...next].slice(0, MAX_PROMPT_ATTACHMENTS);
    entriesRef.current = updated;
    setEntries(updated);
  }, [canAttachEmbeddedContext, canAttachImages]);

  const addLocalRefs = useCallback((refs: readonly LocalRefCandidate[]) => {
    const next: AttachmentEntry[] = [];
    const attachedPaths = new Set(
      entriesRef.current.flatMap((entry) =>
        entry.descriptor.localPath ? [entry.descriptor.localPath] : []
      ),
    );
    let remainingSlots = Math.max(0, MAX_PROMPT_ATTACHMENTS - entriesRef.current.length);
    for (const ref of refs) {
      if (remainingSlots <= 0) {
        break;
      }
      if (attachedPaths.has(ref.path)) {
        continue;
      }
      attachedPaths.add(ref.path);
      next.push({
        file: null,
        descriptor: {
          id: createAttachmentId(),
          name: ref.name,
          mimeType: ref.pathKind === "directory" ? PROMPT_FOLDER_MIME_TYPE : "",
          size: ref.size ?? 0,
          kind: "local_ref",
          source: "upload",
          objectUrl: null,
          localPath: ref.path,
          pathKind: ref.pathKind,
        },
      });
      remainingSlots -= 1;
    }

    if (next.length === 0) {
      return;
    }

    const updated = [...entriesRef.current, ...next].slice(0, MAX_PROMPT_ATTACHMENTS);
    entriesRef.current = updated;
    setEntries(updated);
  }, []);

  const addDroppedFiles = useCallback((files: Iterable<File>) => {
    const fileList = Array.from(files);
    const resolveDroppedPaths = resolveDroppedPathsRef.current;
    if (!resolveDroppedPaths) {
      addFiles(fileList);
      return;
    }
    void resolveDroppedPaths()
      .then((candidates) => {
        if (candidates.length === 0) {
          addFiles(fileList);
          return;
        }
        const { uploadFiles, localRefs } = partitionDroppedPathCandidates(
          candidates,
          fileList,
          { canAttachImages, canAttachEmbeddedContext },
        );
        addFiles(uploadFiles);
        addLocalRefs(localRefs);
      })
      .catch(() => {
        addFiles(fileList);
      });
  }, [addFiles, addLocalRefs, canAttachEmbeddedContext, canAttachImages]);

  const addTextPaste = useCallback((text: string): boolean => {
    if (!canAttachEmbeddedContext || !shouldCreatePasteAttachment(text)) {
      return false;
    }
    if (entriesRef.current.length >= MAX_PROMPT_ATTACHMENTS) {
      return false;
    }
    const file = new File([text], pasteAttachmentName(), { type: "text/plain" });
    if (file.size > PROMPT_TEXT_RESOURCE_MAX_BYTES) {
      return false;
    }
    const entry: AttachmentEntry = {
      file,
      descriptor: {
        id: createAttachmentId(),
        name: file.name,
        mimeType: "text/plain",
        size: file.size,
        kind: "text_resource",
        source: "paste",
        objectUrl: URL.createObjectURL(file),
      },
    };
    const updated = [...entriesRef.current, entry].slice(0, MAX_PROMPT_ATTACHMENTS);
    entriesRef.current = updated;
    setEntries(updated);
    return true;
  }, [canAttachEmbeddedContext]);

  const removeAttachment = useCallback((id: string) => {
    const removed = entriesRef.current.find((entry) => entry.descriptor.id === id);
    if (!removed) {
      return;
    }
    const updated = entriesRef.current.filter((entry) => entry.descriptor.id !== id);
    entriesRef.current = updated;
    setEntries(updated);
    releaseEntries([removed]);
  }, [releaseEntries]);

  const clearAttachments = useCallback(() => {
    if (entriesRef.current.length === 0) {
      return;
    }
    const outgoing = entriesRef.current;
    entriesRef.current = [];
    setEntries([]);
    releaseEntries(outgoing);
  }, [releaseEntries]);

  const clearSubmittedAttachments = useCallback((
    submitted: readonly Pick<PromptAttachmentSnapshot, "id">[],
  ) => {
    const submittedIds = new Set(submitted.map((entry) => entry.id));
    if (submittedIds.size === 0) {
      return;
    }
    const retained: AttachmentEntry[] = [];
    const released: AttachmentEntry[] = [];
    for (const entry of entriesRef.current) {
      if (submittedIds.has(entry.descriptor.id)) {
        released.push(entry);
      } else {
        retained.push(entry);
      }
    }
    entriesRef.current = retained;
    setEntries(retained);
    releaseEntries(released);
  }, [releaseEntries]);

  const isEntrySupported = useCallback((entry: AttachmentEntry): boolean => {
    switch (entry.descriptor.kind) {
      case "image":
        return canAttachImages;
      case "text_resource":
        return canAttachEmbeddedContext;
      case "local_ref":
        // Path references carry no payload, so no upload capability gates them.
        return true;
    }
  }, [canAttachEmbeddedContext, canAttachImages]);

  const snapshotForSubmit = useCallback((): PromptAttachmentSnapshot[] => {
    return entriesRef.current.flatMap((entry) => (
      isEntrySupported(entry)
        ? [createPromptAttachmentSnapshot(entry.descriptor, entry.file)]
        : []
    ));
  }, [isEntrySupported]);

  const hasSupportedAttachments = entries.some(isEntrySupported);

  return useMemo(() => ({
    attachments: descriptors,
    addFiles,
    addDroppedFiles,
    addTextPaste,
    removeAttachment,
    clearAttachments,
    clearSubmittedAttachments,
    snapshotForSubmit,
    hasAttachments: entries.length > 0,
    hasSupportedAttachments,
  }), [
    addDroppedFiles,
    addFiles,
    addTextPaste,
    clearAttachments,
    clearSubmittedAttachments,
    descriptors,
    entries.length,
    hasSupportedAttachments,
    removeAttachment,
    snapshotForSubmit,
  ]);
}
