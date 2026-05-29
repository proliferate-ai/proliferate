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
) {
  const canAttachImages = capabilities?.image === true;
  const canAttachEmbeddedContext = capabilities?.embeddedContext === true;
  const [entries, setEntries] = useState<AttachmentEntry[]>([]);
  const entriesRef = useRef<AttachmentEntry[]>([]);

  useEffect(() => () => {
    for (const entry of entriesRef.current) {
      revokeAttachmentObjectUrl(entry);
    }
    entriesRef.current = [];
  }, []);

  useEffect(() => {
    if (entriesRef.current.length === 0) {
      return;
    }
    for (const entry of entriesRef.current) {
      revokeAttachmentObjectUrl(entry);
    }
    entriesRef.current = [];
    setEntries([]);
  }, [scopeKey, canAttachEmbeddedContext, canAttachImages]);

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
            objectUrl: null,
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
        objectUrl: null,
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
    revokeAttachmentObjectUrl(removed);
    const updated = entriesRef.current.filter((entry) => entry.descriptor.id !== id);
    entriesRef.current = updated;
    setEntries(updated);
  }, []);

  const clearAttachments = useCallback(() => {
    if (entriesRef.current.length === 0) {
      return;
    }
    for (const entry of entriesRef.current) {
      revokeAttachmentObjectUrl(entry);
    }
    entriesRef.current = [];
    setEntries([]);
  }, []);

  const snapshotForSubmit = useCallback((): PromptAttachmentSnapshot[] => {
    return entriesRef.current.map((entry) =>
      createPromptAttachmentSnapshot(entry.descriptor, entry.file)
    );
  }, []);

  return useMemo(() => ({
    attachments: descriptors,
    addFiles,
    addTextPaste,
    removeAttachment,
    clearAttachments,
    snapshotForSubmit,
    hasAttachments: entries.length > 0,
  }), [
    addFiles,
    addTextPaste,
    clearAttachments,
    descriptors,
    entries.length,
    removeAttachment,
    snapshotForSubmit,
  ]);
}
