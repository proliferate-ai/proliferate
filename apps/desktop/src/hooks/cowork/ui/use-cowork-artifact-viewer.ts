import type { CoworkArtifactDetailResponse } from "@anyharness/sdk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildProliferateApiUrl, getProliferateApiOrigin } from "@/lib/infra/proliferate-api";
import {
  buildCoworkRuntimeContentMessage,
  isCoworkRuntimeMessage,
  type CoworkRuntimeMessage,
} from "@/lib/domain/cowork/artifacts";
import { useTauriShellActions } from "@/hooks/access/tauri/use-shell-actions";

export function useCoworkArtifactViewer(
  detail: CoworkArtifactDetailResponse | null,
  enabled: boolean,
) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const { openExternal } = useTauriShellActions();
  const [ready, setReady] = useState(false);
  const [runtimeError, setRuntimeError] = useState<CoworkRuntimeMessage | null>(null);
  const runtimeUrl = useMemo(() => {
    const url = new URL(buildProliferateApiUrl("/artifact-runtime/"));
    url.searchParams.set("parentOrigin", window.location.origin);
    return url.toString();
  }, []);
  const runtimeOrigin = useMemo(() => getProliferateApiOrigin(), []);
  const contentMessage = useMemo(
    () => (detail ? buildCoworkRuntimeContentMessage(detail) : null),
    [detail],
  );

  const postContent = useCallback(() => {
    if (!enabled || !contentMessage) {
      return;
    }

    const targetWindow = iframeRef.current?.contentWindow;
    if (!targetWindow) {
      return;
    }

    targetWindow.postMessage(contentMessage, runtimeOrigin);
  }, [contentMessage, enabled, runtimeOrigin]);

  useEffect(() => {
    setReady(false);
    setRuntimeError(null);
  }, [detail?.artifact.id, enabled]);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    const handleMessage = (event: MessageEvent<unknown>) => {
      if (event.origin !== runtimeOrigin || event.source !== iframeRef.current?.contentWindow) {
        return;
      }

      if (!isCoworkRuntimeMessage(event.data)) {
        return;
      }

      switch (event.data.method) {
        case "ReadyForContent":
          setReady(true);
          setRuntimeError(null);
          break;
        case "OpenLink":
          if (event.data.payload?.url) {
            void openExternal(event.data.payload.url);
          }
          break;
        case "ReportError":
          setRuntimeError(event.data);
          break;
      }
    };

    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [enabled, openExternal, runtimeOrigin]);

  useEffect(() => {
    if (!ready) {
      return;
    }

    postContent();
  }, [postContent, ready]);

  return {
    iframeRef,
    runtimeUrl,
    runtimeError,
  };
}
