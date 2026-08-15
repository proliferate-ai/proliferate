import type { RefObject } from "react";
import {
  ComposerInlineMenuPanel,
  ComposerInlineMenuRow,
} from "#product/components/workspace/chat/input/ComposerInlineMenu";
import { PickerEmptyRow } from "#product/primitives/patterns/PickerPopoverContent";
import { FileTreeEntryIcon } from "#product/components/workspace/files/file-icons";
import type { FileMentionResult } from "#product/lib/domain/chat/composer/file-mention-search";

interface ComposerFileMentionSearchProps {
  results: readonly FileMentionResult[];
  highlightedIndex: number;
  listRef: RefObject<HTMLDivElement | null>;
  query: string;
  isLoading: boolean;
  isError: boolean;
  isPending: boolean;
  runtimeReady: boolean;
  onSelect: (result: FileMentionResult) => void;
  onRowMouseEnter: (index: number) => void;
  setRowRef: (index: number, element: HTMLButtonElement | null) => void;
  getRowId: (index: number) => string;
  className?: string;
}

export function ComposerFileMentionSearch({
  results,
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
  return (
    <ComposerInlineMenuPanel listRef={listRef} label="File mentions" className={className}>
      {results.length > 0 ? (
        results.map((result, index) => (
          <ComposerInlineMenuRow
            key={result.path}
            id={getRowId(index)}
            index={index}
            selected={index === highlightedIndex}
            title={result.path}
            leading={(
              <FileTreeEntryIcon
                name={result.name}
                path={result.path}
                kind="file"
                className="icon-paired shrink-0"
              />
            )}
            primary={<span className="font-control">{result.name}</span>}
            // The directory is the disambiguator between same-named files, so
            // it takes the remaining width and truncates rather than the name.
            secondary={result.parent}
            onSelect={() => onSelect(result)}
            onRowMouseEnter={onRowMouseEnter}
            setRowRef={setRowRef}
          />
        ))
      ) : (
        <PickerEmptyRow
          label={mentionStatusMessage({ query, isLoading, isError, isPending, runtimeReady })}
        />
      )}
    </ComposerInlineMenuPanel>
  );
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
