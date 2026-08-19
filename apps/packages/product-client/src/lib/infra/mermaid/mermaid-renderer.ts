/**
 * Module-level mermaid renderer for mermaid 11.16.1.
 *
 * Proven against the installed types (`dist/mermaid.d.ts`):
 * - `initialize(config)` is process-global. `render(id, text)` does not take
 *   per-call theme or security config.
 * - Concurrent `initialize` calls with different themes would race: the later
 *   init wins for every in-flight `render`.
 * - `render` itself enqueues calls serially, and the SVG `id` must be unique.
 *
 * Because config is global, component instances never call `initialize`.
 * This module owns one security config, a render queue that also serializes
 * theme `initialize`, and monotonically unique diagram ids.
 */
import { sanitizeMermaidSvg } from "./mermaid-svg";

export interface MermaidRenderInput {
  source: string;
  mode: "dark" | "light";
  themeVariables: Record<string, string>;
}

type MermaidModule = typeof import("mermaid").default;

let mermaidModule: MermaidModule | null = null;
let loadPromise: Promise<MermaidModule> | null = null;
let queue: Promise<unknown> = Promise.resolve();
let nextDiagramId = 0;

const SECURITY_CONFIG = {
  startOnLoad: false,
  securityLevel: "strict" as const,
  htmlLabels: false,
  suppressErrorRendering: true,
};

function loadMermaid(): Promise<MermaidModule> {
  if (mermaidModule) {
    return Promise.resolve(mermaidModule);
  }
  loadPromise ??= import("mermaid").then((mod) => {
    mermaidModule = mod.default;
    return mermaidModule;
  });
  return loadPromise;
}

export function renderMermaidDiagram(input: MermaidRenderInput): Promise<string | null> {
  const run = queue.then(
    () => renderMermaidDiagramNow(input),
    () => renderMermaidDiagramNow(input),
  );
  queue = run.then(() => undefined, () => undefined);
  return run;
}

async function renderMermaidDiagramNow({
  source,
  mode,
  themeVariables,
}: MermaidRenderInput): Promise<string | null> {
  const mermaid = await loadMermaid();
  try {
    mermaid.initialize({
      ...SECURITY_CONFIG,
      darkMode: mode === "dark",
      theme: mode === "dark" ? "dark" : "base",
      themeVariables,
      fontFamily: themeVariables.fontFamily,
    });
    const parsed = await mermaid.parse(source, { suppressErrors: true });
    if (!parsed) {
      return null;
    }
    const id = `p-mermaid-${nextDiagramId += 1}`;
    const { svg } = await mermaid.render(id, source);
    return sanitizeMermaidSvg(svg);
  } catch {
    return null;
  }
}

/** Test-only: reset module state between cases. */
export function resetMermaidRendererForTests(): void {
  mermaidModule = null;
  loadPromise = null;
  queue = Promise.resolve();
  nextDiagramId = 0;
}
