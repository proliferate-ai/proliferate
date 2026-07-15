import type { CoworkArtifactDetailResponse } from "@anyharness/sdk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { buildProliferateApiUrl, getProliferateApiOrigin } from "#product/lib/infra/proliferate-api";
import {
  buildCoworkRuntimeContentMessage,
  isCoworkRuntimeMessage,
  type CoworkRuntimeMessage,
} from "#product/lib/domain/cowork/artifacts";

export function useCoworkArtifactViewer(
  detail: CoworkArtifactDetailResponse | null,
  enabled: boolean,
) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const host = useProductHost();
  const { openExternal } = host.links;
  const apiBaseUrl = host.deployment.apiBaseUrl;
  const [ready, setReady] = useState(false);
  const [runtimeError, setRuntimeError] = useState<CoworkRuntimeMessage | null>(null);
  const runtimeUrl = useMemo(() => {
    const url = new URL(buildProliferateApiUrl("/artifact-runtime/", apiBaseUrl));
    url.searchParams.set("parentOrigin", window.location.origin);
    return url.toString();
  }, [apiBaseUrl]);
  const runtimeOrigin = useMemo(
    () => getProliferateApiOrigin(apiBaseUrl),
    [apiBaseUrl],
  );
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
