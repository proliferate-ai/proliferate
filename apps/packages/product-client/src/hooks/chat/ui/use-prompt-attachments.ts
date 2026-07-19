import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PromptCapabilities } from "@anyharness/sdk";
import {
  isTextFileCandidate,
  pasteAttachmentName,
  PROMPT_IMAGE_MAX_BYTES,
  PROMPT_TEXT_RESOURCE_MAX_BYTES,
  shouldCreatePasteAttachment,
  type PromptAttachmentDescriptor,
} from "@proliferate/product-domain/chats/composer/prompt-attachment-rules";
import {
  createPromptAttachmentSnapshot,
  type PromptAttachmentSnapshot,
} from "@proliferate/product-domain/chats/composer/prompt-attachment-snapshot";

interface AttachmentEntry {
  descriptor: PromptAttachmentDescriptor;
  file: File;
}

const MAX_PROMPT_ATTACHMENTS = 10;

export interface PromptAttachmentLifetimeOptions {
  onBeforeReleaseAttachments?: (
    attachments: readonly PromptAttachmentDescriptor[],
  ) => void;
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

  useEffect(() => {
    onBeforeReleaseAttachmentsRef.current = lifetimeOptions.onBeforeReleaseAttachments;
  }, [lifetimeOptions.onBeforeReleaseAttachments]);

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

      if (file.type.startsWith("image/")) {
        if (!canAttachImages || file.size > PROMPT_IMAGE_MAX_BYTES) {
          continue;
        }
        next.push({
          file,
          descriptor: {
            id: createAttachmentId(),
            name: file.name || "image",
            mimeType: file.type || "image/png",
            size: file.size,
            kind: "image",
            source: "upload",
            objectUrl: URL.createObjectURL(file),
          },
        });
        remainingSlots -= 1;
        continue;
      }

      if (canAttachEmbeddedContext && isTextFileCandidate(file)) {
        if (file.size > PROMPT_TEXT_RESOURCE_MAX_BYTES) {
          continue;
        }
        next.push({
          file,
          descriptor: {
            id: createAttachmentId(),
            name: file.name || "file",
            mimeType: file.type || "text/plain",
            size: file.size,
            kind: "text_resource",
            source: "upload",
            objectUrl: URL.createObjectURL(file),
          },
        });
        remainingSlots -= 1;
      }
    }

    if (next.length === 0) {
      return;
    }

    const updated = [...entriesRef.current, ...next].slice(0, MAX_PROMPT_ATTACHMENTS);
    entriesRef.current = updated;
    setEntries(updated);
  }, [canAttachEmbeddedContext, canAttachImages]);

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

  const snapshotForSubmit = useCallback((): PromptAttachmentSnapshot[] => {
    return entriesRef.current.flatMap((entry) => {
      const isSupported = entry.descriptor.kind === "image"
        ? canAttachImages
        : canAttachEmbeddedContext;
      return isSupported
        ? [createPromptAttachmentSnapshot(entry.descriptor, entry.file)]
        : [];
    });
  }, [canAttachEmbeddedContext, canAttachImages]);

  const hasSupportedAttachments = entries.some((entry) => (
    entry.descriptor.kind === "image" ? canAttachImages : canAttachEmbeddedContext
  ));

  return useMemo(() => ({
    attachments: descriptors,
    addFiles,
    addTextPaste,
    removeAttachment,
    clearAttachments,
    clearSubmittedAttachments,
    snapshotForSubmit,
    hasAttachments: entries.length > 0,
    hasSupportedAttachments,
  }), [
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
