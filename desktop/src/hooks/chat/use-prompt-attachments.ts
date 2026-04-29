import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PromptCapabilities, PromptInputBlock } from "@anyharness/sdk";
import {
  isTextFileCandidate,
  PROMPT_IMAGE_MAX_BYTES,
  PROMPT_TEXT_RESOURCE_MAX_BYTES,
  type PromptAttachmentDescriptor,
} from "@/lib/domain/chat/prompt-content";

interface AttachmentEntry {
  descriptor: PromptAttachmentDescriptor;
  file: File;
}

function createAttachmentId(): string {
  return `attachment:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file."));
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      resolve(value.includes(",") ? value.slice(value.indexOf(",") + 1) : value);
    };
    reader.readAsDataURL(file);
  });
}

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file."));
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.readAsText(file);
  });
}

export function usePromptAttachments(capabilities: PromptCapabilities | null | undefined) {
  const [entries, setEntries] = useState<AttachmentEntry[]>([]);
  const entriesRef = useRef<AttachmentEntry[]>([]);

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  useEffect(() => () => {
    for (const entry of entriesRef.current) {
      if (entry.descriptor.objectUrl) {
        URL.revokeObjectURL(entry.descriptor.objectUrl);
      }
    }
  }, []);

  const descriptors = useMemo(
    () => entries.map((entry) => entry.descriptor),
    [entries],
  );

  const addFiles = useCallback((files: Iterable<File>) => {
    const next: AttachmentEntry[] = [];
    for (const file of files) {
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
            objectUrl: URL.createObjectURL(file),
          },
        });
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
            objectUrl: null,
          },
        });
      }
    }

    if (next.length === 0) {
      return;
    }

    setEntries((current) => [...current, ...next].slice(0, 10));
  }, [capabilities?.embeddedContext, capabilities?.image]);

  const removeAttachment = useCallback((id: string) => {
    setEntries((current) => {
      const removed = current.find((entry) => entry.descriptor.id === id);
      if (removed?.descriptor.objectUrl) {
        URL.revokeObjectURL(removed.descriptor.objectUrl);
      }
      return current.filter((entry) => entry.descriptor.id !== id);
    });
  }, []);

  const clearAttachments = useCallback(() => {
    setEntries((current) => {
      for (const entry of current) {
        if (entry.descriptor.objectUrl) {
          URL.revokeObjectURL(entry.descriptor.objectUrl);
        }
      }
      return [];
    });
  }, []);

  const buildBlocks = useCallback(async (text: string): Promise<PromptInputBlock[]> => {
    const blocks: PromptInputBlock[] = [];
    if (text.trim()) {
      blocks.push({ type: "text", text });
    }

    for (const entry of entriesRef.current) {
      if (entry.descriptor.kind === "image") {
        blocks.push({
          type: "image",
          data: await readAsBase64(entry.file),
          mimeType: entry.descriptor.mimeType,
          name: entry.descriptor.name,
        });
        continue;
      }

      blocks.push({
        type: "resource",
        text: await readAsText(entry.file),
        uri: `file://${entry.descriptor.name}`,
        name: entry.descriptor.name,
        mimeType: entry.descriptor.mimeType,
        size: entry.descriptor.size,
      });
    }

    return blocks;
  }, []);

  return {
    attachments: descriptors,
    addFiles,
    removeAttachment,
    clearAttachments,
    buildBlocks,
    hasAttachments: entries.length > 0,
  };
}
