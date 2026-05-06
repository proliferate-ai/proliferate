import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PromptCapabilities } from "@anyharness/sdk";
import {
  isTextFileCandidate,
  pasteAttachmentName,
  PROMPT_IMAGE_MAX_BYTES,
  PROMPT_TEXT_RESOURCE_MAX_BYTES,
  shouldCreatePasteAttachment,
  type PromptAttachmentDescriptor,
} from "@/lib/domain/chat/prompt-content";
import {
  createPromptAttachmentSnapshot,
  type PromptAttachmentSnapshot,
} from "@/lib/domain/chat/prompt-attachment-snapshot";

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
  const [entries, setEntries] = useState<AttachmentEntry[]>([]);
  const entriesRef = useRef<AttachmentEntry[]>([]);

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  useEffect(() => () => {
    for (const entry of entriesRef.current) {
      revokeAttachmentObjectUrl(entry);
    }
  }, []);

  useEffect(() => {
    setEntries((current) => {
      for (const entry of current) {
        revokeAttachmentObjectUrl(entry);
      }
      return [];
    });
  }, [scopeKey, capabilities?.embeddedContext, capabilities?.image]);

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
        if (!capabilities?.image || file.size > PROMPT_IMAGE_MAX_BYTES) {
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

      if (capabilities?.embeddedContext && isTextFileCandidate(file)) {
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

    setEntries((current) => [...current, ...next].slice(0, MAX_PROMPT_ATTACHMENTS));
  }, [capabilities?.embeddedContext, capabilities?.image]);

  const addTextPaste = useCallback((text: string): boolean => {
    if (!capabilities?.embeddedContext || !shouldCreatePasteAttachment(text)) {
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
    setEntries((current) => [...current, entry].slice(0, MAX_PROMPT_ATTACHMENTS));
    return true;
  }, [capabilities?.embeddedContext]);

  const removeAttachment = useCallback((id: string) => {
    setEntries((current) => {
      const removed = current.find((entry) => entry.descriptor.id === id);
      if (removed) {
        revokeAttachmentObjectUrl(removed);
      }
      return current.filter((entry) => entry.descriptor.id !== id);
    });
  }, []);

  const clearAttachments = useCallback(() => {
    setEntries((current) => {
      for (const entry of current) {
        revokeAttachmentObjectUrl(entry);
      }
      return [];
    });
  }, []);

  const snapshotForSubmit = useCallback((): PromptAttachmentSnapshot[] => {
    return entriesRef.current.map((entry) =>
      createPromptAttachmentSnapshot(entry.descriptor, entry.file)
    );
  }, []);

  return {
    attachments: descriptors,
    addFiles,
    addTextPaste,
    removeAttachment,
    clearAttachments,
    snapshotForSubmit,
    hasAttachments: entries.length > 0,
  };
}
