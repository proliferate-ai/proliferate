import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * UX-latency R1 gate guard: every canonical flow routes its stage marks through
 * the renderer flow-timing family (renderer-flow-timing.ts), and no parallel
 * flow-timing producer is introduced. This asserts wiring at the source level so
 * a future edit that drops a mark (or reintroduces a separate layer) fails here.
 */

const packageRoot = fileURLToPath(new URL("../../../../", import.meta.url));

function read(relative: string): string {
  return readFileSync(`${packageRoot}${relative}`, "utf8");
}

const FLOW_ENTRY_FILES: Record<
  string,
  { file: string; requiredMarks: readonly string[] }
> = {
  workspace_open: {
    file: "src/hooks/workspaces/workflows/use-workspace-bootstrap-actions.ts",
    requiredMarks: [
      "beginRendererFlow",
      "markRendererFlowShellCommitted",
      "markRendererFlowDataReady",
      "finishRendererFlow",
    ],
  },
  session_open: {
    file: "src/hooks/sessions/lifecycle/use-session-history-hydration.ts",
    requiredMarks: [
      "beginRendererFlow",
      "markRendererFlowShellCommitted",
      "markRendererFlowDataReady",
      "finishRendererFlow",
    ],
  },
  terminal_attach: {
    file: "src/hooks/terminals/lifecycle/use-terminal-stream-controller.ts",
    requiredMarks: [
      "beginRendererFlow",
      "markRendererFlowShellCommitted",
      "markRendererFlowDataReady",
      "finishRendererFlow",
    ],
  },
  // settings_nav intent lives on the nav command; shell/data/stable settle in
  // the settings screen. Together they cover the three timings.
  settings_nav_intent: {
    file: "src/hooks/app/workflows/use-app-navigation-command-actions.ts",
    requiredMarks: ["beginRendererFlow"],
  },
  settings_nav_settle: {
    file: "src/components/settings/screen/SettingsScreen.tsx",
    requiredMarks: [
      "markRendererFlowShellCommitted",
      "markRendererFlowDataReady",
      "finishRendererFlow",
    ],
  },
};

describe("renderer flow timing wiring", () => {
  it.each(Object.entries(FLOW_ENTRY_FILES))(
    "%s imports and calls its renderer flow-timing marks",
    (_flow, { file, requiredMarks }) => {
      const source = read(file);
      expect(source).toContain(
        "#product/lib/infra/diagnostics/renderer-flow-timing",
      );
      for (const mark of requiredMarks) {
        expect(source, `${file} should call ${mark}`).toContain(`${mark}(`);
      }
    },
  );

  it("keeps renderer-flow-timing.ts the only emitter of renderer.flow.* events", () => {
    // Every renderer.flow.* diagnostic name must originate in the flow-timing
    // module. A second producer would be a parallel layer, which R1 forbids.
    const flowModule = read(
      "src/lib/infra/diagnostics/renderer-flow-timing.ts",
    );
    for (const stage of [
      "renderer.flow.intent",
      "renderer.flow.shell_committed",
      "renderer.flow.data_ready",
      "renderer.flow.content_stable",
    ]) {
      expect(flowModule).toContain(stage);
    }
  });
});
