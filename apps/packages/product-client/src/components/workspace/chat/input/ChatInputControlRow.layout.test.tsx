import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, type Plugin, type ViteDevServer } from "vite";
import { ChatInputControlRow } from "#product/components/workspace/chat/input/ChatInputControlRow";
import { ChatComposerSurface } from "#product/components/workspace/chat/composer/ChatComposerSurface";
import { ComposerControlButton } from "#product/primitives/patterns/composer/ComposerControlButton";
import { List } from "#product/primitives/icons/core";
import {
  CHAT_COLUMN_CLASSNAME,
  CHAT_SURFACE_GUTTER_CLASSNAME,
} from "#product/config/chat-layout";
import { MAIN_PANE_MIN_WIDTH } from "#product/lib/domain/workspaces/shell/right-panel-model";
import type { ModelSelectorProps } from "#product/lib/domain/chat/models/model-selector-types";
import type { LiveSessionControlDescriptor } from "#product/lib/domain/chat/session-controls/session-controls";

// PRO-104 regression: opening the right pane narrows the chat pane and the
// composer control pills painted over each other. The fix is a two-part
// contract — the rail clamp keeps the pane at MAIN_PANE_MIN_WIDTH and the
// compact control tier sheds labels below 32rem of column width — and each
// part is pinned by its own unit test. This test pins the arithmetic that
// links them: at the clamp floor, the real control row rendered with the real
// compiled stylesheet must lay out with zero pairwise control overlap. jsdom
// cannot measure layout, so this renders in headless Chrome the same way
// authenticated-markdown-cascade.test.ts does.

const mocked = vi.hoisted(() => ({
  integrations: {
    mode: "quiet" as "hidden" | "quiet" | "urgent",
    connectedCount: 2,
    providers: [] as unknown[],
    reauthLabel: null as string | null,
  },
}));

// Same provider-backed hooks the sibling unit test mocks. The goal hook
// reports a supported, idle goal so the goal pill — one more control
// competing for row width — participates in the measured layout.
vi.mock("#product/hooks/activity/derived/use-session-goal", () => ({
  useSessionGoal: () => ({ goal: null, capabilities: { supported: true } }),
}));
vi.mock("#product/stores/activity/goal-bar-store", () => ({
  useGoalBarStore: () => () => {},
}));
vi.mock("#product/hooks/cloud/derived/use-composer-integrations-state", () => ({
  useComposerIntegrationsState: () => mocked.integrations,
}));

const WEB_ROOT = fileURLToPath(new URL("../../../../../../../web/", import.meta.url));
const WEB_VITE_CONFIG = fileURLToPath(
  new URL("../../../../../../../web/vite.config.ts", import.meta.url),
);

// Deep enough below the floor that every scenario's shed-and-truncate budget
// is exhausted; the overlap the ticket reported becomes measurable again.
const BELOW_FLOOR_WIDTH = 300;

interface PaneScenario {
  id: string;
  width: number;
  modelName: string;
  /** An unconfigured mode value keeps the pill's shrinkable text label. */
  modeOption: { value: string; label: string };
  integrations: typeof mocked.integrations;
}

const QUIET_INTEGRATIONS: PaneScenario["integrations"] = {
  mode: "quiet",
  connectedCount: 2,
  providers: [],
  reauthLabel: null,
};

const KITCHEN_SINK: Omit<PaneScenario, "id" | "width"> = {
  modelName: "Claude Opus 4.1 Extended Thinking Preview",
  modeOption: { value: "custom_working_mode", label: "Custom working mode" },
  integrations: {
    mode: "urgent",
    connectedCount: 1,
    providers: [],
    reauthLabel: "Reconnect GitHub",
  },
};

const PANES: PaneScenario[] = [
  {
    id: "floor-icon-mode",
    width: MAIN_PANE_MIN_WIDTH,
    modelName: "Opus 4.1",
    modeOption: { value: "bypassPermissions", label: "Bypass" },
    integrations: QUIET_INTEGRATIONS,
  },
  { id: "floor-kitchen-sink", width: MAIN_PANE_MIN_WIDTH, ...KITCHEN_SINK },
  { id: "wide-kitchen-sink", width: 640, ...KITCHEN_SINK },
  { id: "below-floor-kitchen-sink", width: BELOW_FLOOR_WIDTH, ...KITCHEN_SINK },
];

let viteServer: ViteDevServer;
let browser: Browser;
let fixtureUrl: string;

beforeAll(async () => {
  const html = renderFixtureHtml();
  viteServer = await createServer({
    configFile: WEB_VITE_CONFIG,
    root: WEB_ROOT,
    logLevel: "silent",
    plugins: [fixtureRoute(html)],
    server: {
      host: "127.0.0.1",
      port: 0,
      strictPort: false,
    },
  });
  await viteServer.listen();
  const baseUrl = viteServer.resolvedUrls?.local[0];
  if (!baseUrl) {
    throw new Error("Composer overlap fixture did not receive a Vite URL.");
  }
  fixtureUrl = new URL("__composer-overlap", baseUrl).href;
  browser = await chromium.launch({ channel: "chrome", headless: true });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await viteServer?.close();
}, 60_000);

interface PaneMeasurement {
  buttonCount: number;
  overlaps: Array<{ a: string; b: string }>;
  spills: string[];
}

describe("composer control row layout at the right-rail clamp floor", () => {
  it("keeps every control non-overlapping at MAIN_PANE_MIN_WIDTH", async () => {
    const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
    try {
      await page.goto(fixtureUrl, { waitUntil: "networkidle" });

      const result = await page.evaluate(async () => {
        // Font metrics decide label widths; measure only after the real
        // faces are in, or fallback-font widths make the numbers lie.
        await document.fonts.ready;

        const measurePane = (section: HTMLElement): PaneMeasurement => {
          const row = section.querySelector<HTMLElement>("[data-chat-composer-surface] form > div.grid");
          if (!row) throw new Error(`${section.id}: control row was not rendered.`);
          const name = (button: HTMLElement) =>
            (button.getAttribute("aria-label") ?? button.textContent ?? "button").trim().slice(0, 48);
          const rects = Array.from(row.querySelectorAll<HTMLElement>("button"))
            .map((button) => ({ button, rect: button.getBoundingClientRect() }))
            .filter(({ rect }) => rect.width > 0 && rect.height > 0)
            .map(({ button, rect }) => ({ name: name(button), rect }));

          const overlaps: Array<{ a: string; b: string }> = [];
          for (let i = 0; i < rects.length; i += 1) {
            for (let j = i + 1; j < rects.length; j += 1) {
              const a = rects[i].rect;
              const b = rects[j].rect;
              const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
              const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
              if (x > 0.5 && y > 0.5) {
                overlaps.push({ a: rects[i].name, b: rects[j].name });
              }
            }
          }

          const surface = section
            .querySelector<HTMLElement>("[data-chat-composer-surface]")!
            .getBoundingClientRect();
          const spills = rects
            .filter(({ rect }) => rect.left < surface.left - 0.5 || rect.right > surface.right + 0.5)
            .map(({ name: buttonName }) => buttonName);

          return { buttonCount: rects.length, overlaps, spills };
        };

        const panes: Record<string, PaneMeasurement> = {};
        for (const section of document.querySelectorAll<HTMLElement>("section[data-pane]")) {
          panes[section.id] = measurePane(section);
        }
        return panes;
      });

      // Every control rendered: model, mode, reasoning, fast mode, goal,
      // integrations, attach, workspace status, send. A sparse row would
      // make the no-overlap assertions vacuous.
      for (const pane of PANES) {
        expect(result[pane.id]?.buttonCount, pane.id).toBeGreaterThanOrEqual(8);
      }

      expect(result["floor-icon-mode"].overlaps).toEqual([]);
      expect(result["floor-icon-mode"].spills).toEqual([]);
      expect(result["floor-kitchen-sink"].overlaps).toEqual([]);
      expect(result["floor-kitchen-sink"].spills).toEqual([]);
      expect(result["wide-kitchen-sink"].overlaps).toEqual([]);
      expect(result["wide-kitchen-sink"].spills).toEqual([]);

      // Negative control: far below the clamp floor the shed-and-truncate
      // budget runs out and controls do overlap. This proves the detector
      // detects — and that MAIN_PANE_MIN_WIDTH is load-bearing, not slack.
      expect(result["below-floor-kitchen-sink"].overlaps.length).toBeGreaterThan(0);
    } finally {
      await page.close();
    }
  }, 60_000);
});

function createModelSelectorProps(displayName: string): ModelSelectorProps {
  return {
    connectionState: "healthy",
    currentModel: {
      kind: "claude",
      displayName,
      pendingState: null,
    },
    groups: [
      {
        kind: "claude",
        providerDisplayName: "Claude Code",
        models: [
          {
            kind: "claude",
            modelId: "model-1",
            displayName,
            actionKind: "select",
            isSelected: true,
            isUnsupported: false,
          },
        ],
      },
    ],
    hasAgents: true,
    isLoading: false,
    onSelect: () => {},
  };
}

function createControls(modeOption: PaneScenario["modeOption"]): LiveSessionControlDescriptor[] {
  return [
    {
      key: "collaboration_mode",
      label: "Mode",
      detail: modeOption.label,
      rawConfigId: "collaboration_mode",
      settable: true,
      pendingState: null,
      kind: "select",
      options: [
        { value: modeOption.value, label: modeOption.label, selected: true },
        { value: "plan", label: "Plan", selected: false },
      ],
      onSelect: () => {},
    },
    {
      key: "effort",
      label: "Reasoning effort",
      detail: "Medium",
      rawConfigId: "effort",
      settable: true,
      pendingState: null,
      kind: "select",
      options: [
        { value: "low", label: "Low", selected: false },
        { value: "medium", label: "Medium", selected: true },
        { value: "high", label: "High", selected: false },
      ],
      onSelect: () => {},
    },
    {
      key: "fast_mode",
      label: "Fast mode",
      detail: "Off",
      rawConfigId: "fast_mode",
      settable: true,
      pendingState: null,
      kind: "toggle",
      enabledValue: "on",
      disabledValue: "off",
      isEnabled: false,
      options: [
        { value: "off", label: "Off", selected: true },
        { value: "on", label: "On", selected: false },
      ],
      onSelect: () => {},
    },
  ];
}

function ComposerPane({ scenario }: { scenario: PaneScenario }) {
  return (
    <section id={scenario.id} data-pane="true" style={{ width: scenario.width }}>
      {/* Production nesting from ChatComposerDock: gutter column, container-
          query column, composer surface, form. The compact tier resolves
          against the @container div, so the replica must keep it. */}
      <div className={`pointer-events-none relative z-raised pb-4 ${CHAT_SURFACE_GUTTER_CLASSNAME}`}>
        <div
          data-chat-composer-column="true"
          className={`pointer-events-auto relative @container ${CHAT_COLUMN_CLASSNAME}`}
        >
          <ChatComposerSurface overflowMode="clip">
            <form className="relative flex flex-col">
              <div style={{ height: 40 }} />
              <ChatInputControlRow
                runtimeControlsDisabled={false}
                modelSelectorProps={createModelSelectorProps(scenario.modelName)}
                agentKind="claude"
                sessionConfigControls={createControls(scenario.modeOption)}
                isEditingQueuedPrompt={false}
                chatDisabled={false}
                isSubmitting={false}
                supportsAttachments
                canAttachFiles
                activeSessionId="session-1"
                onAttachFile={() => {}}
                isRunning={false}
                isEmpty={false}
                onSubmit={() => {}}
                onCancel={() => {}}
                statusControl={(
                  <ComposerControlButton
                    iconOnly
                    icon={<List className="icon-control" />}
                    label="Workspace status"
                    aria-label="Workspace status"
                  />
                )}
              />
            </form>
          </ChatComposerSurface>
        </div>
      </div>
    </section>
  );
}

function renderFixtureHtml(): string {
  const sections = PANES.map((scenario) => {
    mocked.integrations = scenario.integrations;
    return renderToStaticMarkup(
      <MemoryRouter>
        <ComposerPane scenario={scenario} />
      </MemoryRouter>,
    );
  }).join("\n");

  return `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <link rel="stylesheet" href="/src/index.css" />
        <style>
          body { margin: 0; padding: 24px; overflow: auto; }
          section[data-pane] { margin-bottom: 24px; }
        </style>
      </head>
      <body>
        ${sections}
      </body>
    </html>`;
}

function fixtureRoute(html: string): Plugin {
  return {
    name: "composer-overlap-fixture",
    configureServer(server) {
      server.middlewares.use("/__composer-overlap", (_request, response) => {
        response.setHeader("Content-Type", "text/html");
        response.end(html);
      });
    },
  };
}
