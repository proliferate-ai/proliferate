# Artifact Runtime

Status: authoritative for the hosted artifact viewer runtime.

Scope:

- `server/artifact-runtime/**`
- desktop integration that loads `<api-base>/artifact-runtime/`
- the desktop/runtime `postMessage` protocol
- per-type renderers, especially raw JSX processing

Use this doc to answer the runtime questions that do not belong in the
AnyHarness artifact lifecycle doc:

- what the runtime is
- how the desktop and runtime talk
- how each supported artifact type renders
- how raw JSX is validated and executed
- what the security boundary is

## 1. Core Architecture

The artifact runtime is a separate frontend app hosted from the control-plane
server.

- desktop shell owns selection, artifact fetch, and iframe mounting
- runtime owns rendering the artifact content
- desktop and runtime communicate only through `postMessage`

The runtime is hosted at the control-plane API base under:

```text
<api-base>/artifact-runtime/
```

It is public and stateless. It does not require auth.

## 2. v1 Supported Artifact Types

The runtime supports these artifact types only:

- `text/markdown`
- `text/html`
- `image/svg+xml`
- `application/vnd.proliferate.react`

Explicitly out of scope for this phase:

- Mermaid
- artifact-initiated MCP calls
- publish/share flows
- persistence APIs

## 3. Runtime File Layout

Target project shape:

```text
server/artifact-runtime/
  package.json
  vite.config.ts
  public/
    index.html
  src/
    index.ts
    bridge.ts
    dispatcher.ts
    types.ts
    renderers/
      markdown.ts
      html.ts
      svg.ts
      jsx.ts
    jsx/
      parse-imports.ts
      library-registry.ts
      require-shim.ts
      transform.ts
      envelope.ts
  assets/
    tailwind-bundled.css
```

The runtime app is separate from the desktop bundle. The desktop loads it in an iframe.

## 4. Desktop ↔ Runtime Protocol

Only four message types are allowed in v1.

### Runtime to desktop

```ts
type RuntimeToDesktopMessage =
  | { method: "ReadyForContent" }
  | { method: "OpenLink"; payload: { url: string } }
  | { method: "ReportError"; payload: RuntimeErrorPayload };
```

### Desktop to runtime

```ts
type DesktopToRuntimeMessage = {
  method: "SetContent";
  payload: {
    artifactId: string;
    type: ArtifactRuntimeType;
    title: string;
    content: string;
  };
};
```

### Artifact type enum

```ts
type ArtifactRuntimeType =
  | "text/markdown"
  | "text/html"
  | "image/svg+xml"
  | "application/vnd.proliferate.react";
```

Rules:

- runtime sends `ReadyForContent` once after boot
- desktop waits for `ReadyForContent` before sending `SetContent`
- each artifact open sends one fresh `SetContent`
- the runtime does not fetch artifact content itself in v1
- desktop passes its own origin to the runtime iframe so the runtime can target
  `postMessage` precisely without falling back to `*`

## 5. Security Model

The runtime is safe because it is isolated from the desktop app by origin and iframe sandboxing.

### Outer iframe

Desktop loads the runtime with:

```html
<iframe
  src="https://<server><api-base>/artifact-runtime/?parentOrigin=<desktop-origin>"
  sandbox="allow-scripts allow-same-origin"
  allow="clipboard-write"
/>
```

The outer runtime iframe needs `allow-same-origin` because the current hosted
runtime loads versioned static assets, executes a raw-JSX transform path, and
communicates back to desktop via `postMessage` using the control-plane origin as
its real origin.

Do not add `allow-popups` or `allow-top-navigation`.

### CSP

The runtime page must be served with a strict CSP.

Minimum v1 requirements:

- `default-src 'self'`
- `connect-src 'none'`
- `frame-src 'self'`
- `form-action 'none'`
- `base-uri 'self'`

If pinned CDN script loads are used for JSX libraries, `script-src` must
allow only those pinned origins.

Nested JSX envelopes may require `'unsafe-inline'` because the runtime
generates the module wrapper dynamically. The current raw-JSX runtime also
requires `'unsafe-eval'` because the transformed module is executed through a
runtime-generated function wrapper. Keep those allowances narrow and
code-owned.

### Origin validation

Both sides validate origin on every message.

- runtime only accepts `SetContent` from approved desktop origins
- runtime only forwards nested iframe messages from runtime-owned child frames
- desktop only accepts runtime messages from the runtime origin

### No runtime MCP bridge in v1

The runtime does not expose `callMcpTool`, storage, or fetch proxy APIs.
`OpenLink` is the only outward action.

## 6. Per-Type Renderer Contract

### Markdown

- parse markdown to HTML
- sanitize with DOMPurify
- render inline in the runtime DOM
- intercept link clicks and forward `OpenLink`

Markdown is an inline renderer, not a nested iframe renderer.

### SVG

- sanitize with DOMPurify using the SVG profile
- forbid dangerous tags like `script` and `foreignObject`
- render inline in the runtime DOM
- intercept links and forward `OpenLink`

SVG is an inline renderer, not a nested iframe renderer.

### HTML

- treat the artifact content as a complete HTML document
- inject a link interception script before `</body>` when possible
- mount the document in a nested iframe using `srcdoc`
- nested iframe uses `sandbox="allow-scripts"`

HTML is always rendered in a nested iframe.

### JSX / TSX

- treat artifact content as raw component source
- validate imports
- transform source
- build a nested iframe HTML envelope
- execute the transformed component inside that nested iframe
- nested iframe uses `sandbox="allow-scripts allow-same-origin"`

JSX is always rendered in a nested iframe.

## 7. Raw JSX Contract

### Required input shape

The artifact content must be a complete `.jsx` or `.tsx` module that:

- uses a default export
- exports a React component
- requires no props
- only imports modules from the allowlist

Example:

```tsx
import { useState } from "react";
import { Plus } from "lucide-react";

export default function ExampleArtifact() {
  const [count, setCount] = useState(0);
  return (
    <div className="p-6">
      <button onClick={() => setCount((value) => value + 1)}>
        <Plus />
        {count}
      </button>
    </div>
  );
}
```

### Initial allowlist

The allowlist is fixed in `src/jsx/library-registry.ts`.

Initial allowed imports:

- `react`
- `react-dom`
- `lucide-react`
- `recharts`
- `lodash`
- `d3`
- `date-fns`

The agent cannot add libraries dynamically. New libraries require a code change.

### JSX processing pipeline

The renderer must follow this order:

1. receive raw source from `SetContent`
2. parse import statements
3. validate every import against the allowlist
4. load required libraries from the registry
5. transform source with Sucrase:
   - `jsx`
   - `typescript`
   - `imports`
6. build a nested iframe HTML envelope
7. install a `require()` shim backed by the loaded registry
8. evaluate the transformed module
9. read `exports.default`
10. mount with `ReactDOM.createRoot(...).render(...)`

### Asset strategy

The runtime bundle owns the orchestration code.

The JSX iframe envelope may rely on:

- same-origin static assets served from the same public mount as the runtime page
- pinned CDN URLs explicitly declared in `library-registry.ts`

The important invariant is that module resolution is fixed and code-owned.
It must not depend on artifact-authored URLs.

### Styling model

v1 JSX artifacts use Tailwind utility classes.

The JSX iframe envelope loads:

- a prebuilt Tailwind stylesheet from the runtime assets

There is no artifact-specific theming or design-token injection in v1.

## 8. JSX Error Taxonomy

The runtime reports typed errors through `ReportError`.

```ts
type RuntimeErrorPayload =
  | { type: "UnsupportedImports"; modules: string[] }
  | { type: "LibraryLoadFailed"; modules: string[] }
  | { type: "TransformError"; message: string }
  | { type: "RuntimeError"; message: string };
```

Rules:

- import validation failure reports `UnsupportedImports`
- missing or failed registry loads report `LibraryLoadFailed`
- Sucrase failures report `TransformError`
- execution failures report `RuntimeError`

Desktop owns user-facing error presentation. The runtime only emits typed failures.

## 9. Desktop Integration Expectations

Desktop is responsible for:

- fetching artifact content from AnyHarness
- mounting the runtime iframe
- waiting for `ReadyForContent`
- posting `SetContent`
- handling `OpenLink`
- handling `ReportError`

The runtime is responsible for:

- rendering one artifact at a time
- re-rendering fully on each `SetContent`
- keeping no durable state across artifact opens

## 10. Explicit Non-Goals For This Phase

- Mermaid support
- artifact-initiated MCP calls
- artifact storage APIs
- offline runtime bundle inside desktop
- cross-artifact navigation state
- multi-file JSX projects
- arbitrary npm import support
