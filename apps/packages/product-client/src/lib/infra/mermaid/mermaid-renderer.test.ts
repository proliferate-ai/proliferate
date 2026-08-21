// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  parse: vi.fn(async () => ({ diagramType: "flowchart-v2" })),
  render: vi.fn(async (id: string) => ({
    svg: `<svg xmlns="http://www.w3.org/2000/svg" id="${id}"><path d="M0 0" /></svg>`,
  })),
}));

vi.mock("mermaid", () => ({
  default: mermaid,
}));

import {
  renderMermaidDiagram,
  resetMermaidRendererForTests,
} from "./mermaid-renderer";

describe("renderMermaidDiagram", () => {
  beforeEach(() => {
    resetMermaidRendererForTests();
    mermaid.initialize.mockReset();
    mermaid.parse.mockReset();
    mermaid.render.mockReset();
    mermaid.parse.mockResolvedValue({ diagramType: "flowchart-v2" });
    mermaid.render.mockImplementation(async (id: string) => ({
      svg: `<svg xmlns="http://www.w3.org/2000/svg" id="${id}"><path d="M0 0" /></svg>`,
    }));
  });

  afterEach(() => {
    resetMermaidRendererForTests();
  });

  it("serializes initialize and render so concurrent themes cannot overlap", async () => {
    const events: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstHold = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    mermaid.initialize.mockImplementation((config: { theme?: string }) => {
      events.push(`init:${config.theme ?? ""}`);
    });
    mermaid.render.mockImplementation(async (id: string) => {
      events.push(`render-start:${id}`);
      if (events.filter((event) => event.startsWith("render-start:")).length === 1) {
        await firstHold;
      }
      events.push(`render-end:${id}`);
      return {
        svg: `<svg xmlns="http://www.w3.org/2000/svg" id="${id}"><path d="M0 0" /></svg>`,
      };
    });

    const dark = renderMermaidDiagram({
      source: "flowchart LR\n  A --> B",
      mode: "dark",
      themeVariables: { background: "var(--color-background)" },
    });
    const light = renderMermaidDiagram({
      source: "flowchart LR\n  C --> D",
      mode: "light",
      themeVariables: { background: "var(--color-card)" },
    });

    await vi.waitFor(() => {
      expect(events).toEqual(["init:dark", "render-start:p-mermaid-1"]);
    });

    releaseFirst?.();
    await Promise.all([dark, light]);

    expect(events).toEqual([
      "init:dark",
      "render-start:p-mermaid-1",
      "render-end:p-mermaid-1",
      "init:base",
      "render-start:p-mermaid-2",
      "render-end:p-mermaid-2",
    ]);
    expect(mermaid.initialize.mock.calls[0]?.[0]).toMatchObject({
      startOnLoad: false,
      securityLevel: "strict",
      htmlLabels: false,
      suppressErrorRendering: true,
    });
  });

  it("assigns unique diagram ids to concurrent renders", async () => {
    const [first, second] = await Promise.all([
      renderMermaidDiagram({
        source: "flowchart LR\n  A --> B",
        mode: "dark",
        themeVariables: {},
      }),
      renderMermaidDiagram({
        source: "flowchart LR\n  C --> D",
        mode: "dark",
        themeVariables: {},
      }),
    ]);

    const ids = mermaid.render.mock.calls.map((call) => call[0]);
    expect(ids).toEqual(["p-mermaid-1", "p-mermaid-2"]);
    expect(first).toContain('id="p-mermaid-1"');
    expect(second).toContain('id="p-mermaid-2"');
  });

  it("returns null when parse rejects the source", async () => {
    mermaid.parse.mockResolvedValueOnce(false);
    await expect(renderMermaidDiagram({
      source: "not a diagram",
      mode: "dark",
      themeVariables: {},
    })).resolves.toBeNull();
    expect(mermaid.render).not.toHaveBeenCalled();
  });
});
