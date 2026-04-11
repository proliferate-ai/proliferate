import { renderHtml } from "./renderers/html";
import { renderJsx } from "./renderers/jsx";
import { renderMarkdown } from "./renderers/markdown";
import { renderSvg } from "./renderers/svg";
import type { RuntimeErrorPayload, SetContentPayload } from "./types";

interface DispatchOptions {
  container: HTMLElement;
  payload: SetContentPayload;
  clearChildFrames: () => void;
  registerChildFrame: (iframe: HTMLIFrameElement) => void;
  onOpenLink: (url: string) => void;
  onError: (error: RuntimeErrorPayload) => void;
}

export async function dispatchArtifactRender({
  container,
  payload,
  clearChildFrames,
  registerChildFrame,
  onOpenLink,
  onError,
}: DispatchOptions): Promise<void> {
  clearChildFrames();

  switch (payload.type) {
    case "text/markdown":
      await renderMarkdown({ container, content: payload.content, onOpenLink });
      return;
    case "text/html":
      await renderHtml({
        container,
        content: payload.content,
        registerChildFrame,
      });
      return;
    case "image/svg+xml":
      await renderSvg({ container, content: payload.content, onOpenLink });
      return;
    case "application/vnd.proliferate.react":
      await renderJsx({
        container,
        content: payload.content,
        registerChildFrame,
        onError,
      });
      return;
  }
}
