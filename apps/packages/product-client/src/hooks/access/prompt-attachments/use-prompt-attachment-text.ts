import { useCallback, useEffect, useState } from "react";

export interface PromptAttachmentTextState {
  data: string | null;
  isLoading: boolean;
  isError: boolean;
}

export function usePromptAttachmentObjectUrlText(
  objectUrl: string | null,
): PromptAttachmentTextState {
  const readObjectUrl = useCallback(async (source: string, signal: AbortSignal) => {
    const response = await fetch(source, { signal });
    if (!response.ok) {
      throw new Error(`Attachment preview failed with ${response.status}`);
    }
    return response.text();
  }, []);
  return usePromptAttachmentTextSource(objectUrl, readObjectUrl);
}

export function usePromptAttachmentBlobText(
  blob: Blob | null,
): PromptAttachmentTextState {
  const readBlob = useCallback((source: Blob) => source.text(), []);
  return usePromptAttachmentTextSource(blob, readBlob);
}

function usePromptAttachmentTextSource<Source extends string | Blob>(
  source: Source | null,
  read: (source: Source, signal: AbortSignal) => Promise<string>,
): PromptAttachmentTextState {
  const [state, setState] = useState<PromptAttachmentTextState & {
    source: Source | null;
  }>(() => initialState<Source>(source));
  const visibleState = state.source === source ? state : initialState<Source>(source);

  useEffect(() => {
    const abortController = new AbortController();
    if (!source) {
      setState(initialState<Source>(null));
      return () => abortController.abort();
    }
    setState(initialState<Source>(source));
    void read(source, abortController.signal)
      .then((data) => {
        if (!abortController.signal.aborted) {
          setState({ source, data, isLoading: false, isError: false });
        }
      })
      .catch(() => {
        if (!abortController.signal.aborted) {
          setState({ source, data: null, isLoading: false, isError: true });
        }
      });
    return () => abortController.abort();
  }, [read, source]);

  return {
    data: visibleState.data,
    isLoading: visibleState.isLoading,
    isError: visibleState.isError,
  };
}

function initialState<Source extends string | Blob>(
  source: Source | null,
): PromptAttachmentTextState & { source: Source | null } {
  return {
    source,
    data: null,
    isLoading: source !== null,
    isError: false,
  };
}
