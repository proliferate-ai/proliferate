import {
  REACT_DOM_CLIENT_DESCRIPTOR,
  TAILWIND_BROWSER_URL,
  type ArtifactLibraryDescriptor,
} from "./library-registry";
import { buildRequireShim } from "./require-shim";

interface BuildEnvelopeOptions {
  compiledSource: string;
  libraries: ArtifactLibraryDescriptor[];
  runtimeOrigin: string;
  stylesheetHref: string;
}

export function buildJsxEnvelope({
  compiledSource,
  libraries,
  runtimeOrigin,
  stylesheetHref,
}: BuildEnvelopeOptions): string {
  const libraryUrls = libraries.map((library) => library.url);
  const libraryModules = libraries.map((library) => library.moduleName);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${stylesheetHref}" />
    <script src="${TAILWIND_BROWSER_URL}"></script>
    <style>
      html, body, #artifact-root {
        min-height: 100%;
        margin: 0;
        background: #ffffff;
        color: #111827;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
    </style>
  </head>
  <body>
    <div id="artifact-root"></div>
    <script type="module">
      const targetOrigin = ${JSON.stringify(runtimeOrigin)};
      try {
        const [ReactDOMClient, ...loadedLibraries] = await Promise.all([
          import(${JSON.stringify(REACT_DOM_CLIENT_DESCRIPTOR.url)}),
          ${libraryUrls.map((url) => `import(${JSON.stringify(url)})`).join(",\n          ")}
        ]);
        ${libraries.map((_, index) => `const lib${index} = loadedLibraries[${index}];`).join("\n        ")}
        ${buildRequireShim(libraries)}
        const React = require("react").default ?? require("react");
        const module = { exports: {} };
        const exports = module.exports;
        const runModule = new Function("require", "module", "exports", "React", ${JSON.stringify(compiledSource)});
        runModule(require, module, exports, React);
        const Component = module.exports.default ?? exports.default;
        if (typeof Component !== "function") {
          throw new Error("JSX artifact must default export a React component.");
        }
        const root = ReactDOMClient.createRoot(document.getElementById("artifact-root"));
        root.render(React.createElement(Component));
      } catch (error) {
        const failedMessage = String(error instanceof Error ? error.message : error);
        const isLibraryFailure = failedMessage.includes("Failed to fetch dynamically imported module");
        window.parent.postMessage({
          method: "ReportError",
          payload: {
            type: isLibraryFailure ? "LibraryLoadFailed" : "RuntimeError",
            ...(isLibraryFailure
              ? { modules: ${JSON.stringify(libraryModules)} }
              : { message: failedMessage }),
          },
        }, targetOrigin);
      }

      window.addEventListener("error", (event) => {
        window.parent.postMessage({
          method: "ReportError",
          payload: {
            type: "RuntimeError",
            message: String(event.error?.message || event.message || "Artifact runtime failed"),
          },
        }, targetOrigin);
      });

      document.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const anchor = target.closest("a[href]");
        if (!(anchor instanceof HTMLAnchorElement)) return;
        event.preventDefault();
        window.parent.postMessage({
          method: "OpenLink",
          payload: { url: anchor.href },
        }, targetOrigin);
      });
    </script>
  </body>
</html>`;
}
