import { buildJsxEnvelope } from "../jsx/envelope";
import { resolveArtifactLibraries } from "../jsx/library-registry";
import { parseImports } from "../jsx/parse-imports";
import { transformJsxSource } from "../jsx/transform";
import type { RuntimeErrorPayload } from "../types";

interface RenderJsxOptions {
  container: HTMLElement;
  content: string;
  registerChildFrame: (iframe: HTMLIFrameElement) => void;
  onError: (payload: RuntimeErrorPayload) => void;
}

export async function renderJsx({
  container,
  content,
  registerChildFrame,
  onError,
}: RenderJsxOptions): Promise<void> {
  const imports = parseImports(content);
  const requiredModules = imports.includes("react")
    ? imports
    : ["react", ...imports];
  const { libraries, unsupported } = resolveArtifactLibraries(requiredModules);
  if (unsupported.length > 0) {
    onError({ type: "UnsupportedImports", modules: unsupported });
    container.replaceChildren();
    return;
  }

  let compiledSource: string;
  try {
    compiledSource = transformJsxSource(content);
  } catch (error) {
    onError({
      type: "TransformError",
      message: error instanceof Error ? error.message : String(error),
    });
    container.replaceChildren();
    return;
  }

  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
  iframe.className = "artifact-frame";
  iframe.srcdoc = buildJsxEnvelope({
    compiledSource,
    libraries,
    runtimeOrigin: window.location.origin,
    stylesheetHref: new URL("./tailwind-bundled.css", window.location.href).toString(),
  });
  container.replaceChildren(iframe);
  registerChildFrame(iframe);
}
