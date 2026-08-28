import type { ReactNode, RefObject } from "react";
import {
  ComposerInlineMenuGroupLabel,
  ComposerInlineMenuPanel,
  ComposerInlineMenuRow,
} from "#product/components/workspace/chat/input/ComposerInlineMenu";
import { PickerEmptyRow } from "#product/primitives/patterns/PickerPopoverContent";
import { FileText } from "#product/primitives/icons/workspace";
import { FileTreeEntryIcon } from "#product/components/workspace/files/file-icons";
import type { ChatMentionMenuItem } from "#product/lib/domain/chat/composer/chat-mention-items";
import { contextDocMentionWorkspacePath } from "#product/lib/domain/chat/composer/context-doc-mention";

interface ComposerFileMentionSearchProps {
  items: readonly ChatMentionMenuItem[];
  highlightedIndex: number;
  listRef: RefObject<HTMLDivElement | null>;
  query: string;
  isLoading: boolean;
  isError: boolean;
  isPending: boolean;
  runtimeReady: boolean;
  onSelect: (item: ChatMentionMenuItem) => void;
  onRowMouseEnter: (index: number) => void;
  setRowRef: (index: number, element: HTMLButtonElement | null) => void;
  getRowId: (index: number) => string;
  className?: string;
}

export function ComposerFileMentionSearch({
  items,
  highlightedIndex,
  listRef,
  query,
  isLoading,
  isError,
  isPending,
  runtimeReady,
  onSelect,
  onRowMouseEnter,
  setRowRef,
  getRowId,
  className,
}: ComposerFileMentionSearchProps) {
  // Group labels appear only when both sources contribute rows; the common
  // file-only menu (context-doc source disabled or empty) stays label-free and
  // renders exactly as it did before docs existed.
  const docCount = items.filter((item) => item.kind === "contextDoc").length;
  const grouped = docCount > 0;
  return (
    <ComposerInlineMenuPanel listRef={listRef} label="File mentions" className={className}>
      {items.length > 0 ? (
        items.map((item, index) => {
          const row = (
            <ComposerInlineMenuRow
              key={mentionItemKey(item)}
              id={getRowId(index)}
              index={index}
              selected={index === highlightedIndex}
              {...mentionRowContent(item)}
              onSelect={() => onSelect(item)}
              onRowMouseEnter={onRowMouseEnter}
              setRowRef={setRowRef}
            />
          );
          if (!grouped) {
            return row;
          }
          // The merged list is docs-first, so the group boundaries are index 0
          // and the first file index (= docCount).
          const heading = index === 0
            ? "Context docs"
            : index === docCount
              ? "Files"
              : null;
          return heading ? (
            <MentionGroup key={`group:${mentionItemKey(item)}`} heading={heading}>
              {row}
            </MentionGroup>
          ) : row;
        })
      ) : (
        <PickerEmptyRow
          label={mentionStatusMessage({ query, isLoading, isError, isPending, runtimeReady })}
        />
      )}
    </ComposerInlineMenuPanel>
  );
}

function MentionGroup({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <>
      <ComposerInlineMenuGroupLabel>{heading}</ComposerInlineMenuGroupLabel>
      {children}
    </>
  );
}

function mentionRowContent(item: ChatMentionMenuItem): {
  title: string;
  leading: ReactNode;
  primary: ReactNode;
  secondary: ReactNode;
} {
  if (item.kind === "contextDoc") {
    return {
      title: contextDocMentionWorkspacePath(item.doc),
      leading: <FileText className="icon-paired shrink-0" />,
      primary: <span className="font-control">{item.doc.filename}</span>,
      secondary: item.doc.runLabel ?? "Workflow run",
    };
  }
  return {
    title: item.file.path,
    leading: (
      <FileTreeEntryIcon
        name={item.file.name}
        path={item.file.path}
        kind="file"
        className="icon-paired shrink-0"
      />
    ),
    primary: <span className="font-control">{item.file.name}</span>,
    // The directory is the disambiguator between same-named files, so it takes
    // the remaining width and truncates rather than the name.
    secondary: item.file.parent,
  };
}

function mentionItemKey(item: ChatMentionMenuItem): string {
  return item.kind === "contextDoc" ? `doc:${item.doc.docId}` : `file:${item.file.path}`;
}

function mentionStatusMessage({
  query,
  isLoading,
  isError,
  isPending,
  runtimeReady,
}: {
  query: string;
  isLoading: boolean;
  isError: boolean;
  isPending: boolean;
  runtimeReady: boolean;
}): string {
  if (!runtimeReady) {
    return "Workspace files are not available yet.";
  }
  if (query.trim().length === 0) {
    return "Type to search workspace files.";
  }
  if (isError) {
    return "File search failed.";
  }
  if (isLoading || isPending) {
    return "Searching files…";
  }
  return "No matching files.";
}
