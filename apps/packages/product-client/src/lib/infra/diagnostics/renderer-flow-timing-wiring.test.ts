import { readdirSync, readFileSync } from "node:fs";
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
  // composer_submit and mode_switch (R12) are two-point flows: begin/finish
  // only, split across an intent-side file and a commit-side file each.
  composer_submit_intent: {
    file: "src/hooks/chat/workflows/use-chat-prompt-actions.ts",
    requiredMarks: ["beginRendererFlow"],
  },
  composer_submit_stable: {
    file: "src/hooks/sessions/lifecycle/session-stream-flush-apply.ts",
    requiredMarks: ["finishRendererFlow"],
  },
  mode_switch_intent: {
    file: "src/hooks/sessions/workflows/use-session-intent-actions.ts",
    requiredMarks: ["beginRendererFlow"],
  },
  mode_switch_commit: {
    file: "src/hooks/sessions/lifecycle/session-intent-config-dispatch.ts",
    requiredMarks: ["finishRendererFlow"],
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

  it("keeps renderer-flow-timing.ts the only source that emits renderer.flow.* records", () => {
    // Real source-tree scan (not a tautological single-file read): walk the whole
    // package src and assert no file other than the flow-timing module emits a
    // `name: "renderer.flow.*"` diagnostic record. A second producer would be the
    // parallel layer R1 forbids; test-wiring references (this file, unit tests)
    // are allowed because they never call recordRendererDiagnostic.
    const srcRoot = fileURLToPath(new URL("../../../../src", import.meta.url));
    const OWNER = "lib/infra/diagnostics/renderer-flow-timing.ts";
    // Matches a diagnostic record's own name key, e.g. name: "renderer.flow.intent"
    const emitPattern = /name:\s*["'`]renderer\.flow\./;

    function walk(dir: string): string[] {
      const out: string[] = [];
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          out.push(...walk(full));
        } else if (/\.(ts|tsx)$/.test(entry.name)) {
          out.push(full);
        }
      }
      return out;
    }

    const offenders: string[] = [];
    for (const file of walk(srcRoot)) {
      const rel = file.slice(srcRoot.length + 1);
      if (rel === "lib/infra/diagnostics/renderer-flow-timing.ts") {
        continue;
      }
      // Tests reference the names but never emit records; skip them.
      if (/\.test\.(ts|tsx)$/.test(rel)) {
        continue;
      }
      if (emitPattern.test(readFileSync(file, "utf8"))) {
        offenders.push(rel);
      }
    }

    expect(
      offenders,
      `only ${OWNER} may emit renderer.flow.* records; offenders: ${offenders.join(", ")}`,
    ).toEqual([]);

    // Sanity: the owner really does emit every stage (guards a rename that would
    // make the scan vacuously pass).
    const flowModule = read(`src/${OWNER}`);
    for (const stage of [
      "renderer.flow.intent",
      "renderer.flow.shell_committed",
      "renderer.flow.data_ready",
      "renderer.flow.content_stable",
      "renderer.flow.abandoned",
    ]) {
      expect(flowModule).toContain(stage);
    }
  });
});
