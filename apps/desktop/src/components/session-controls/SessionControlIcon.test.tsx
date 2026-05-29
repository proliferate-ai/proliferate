import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SESSION_CONTROL_PRESENTATIONS } from "@/lib/domain/chat/session-controls/presentation";
import type { SessionControlIconKey } from "@/lib/domain/chat/session-controls/presentation";
import { resolveConfiguredSessionControlValue } from "@/lib/domain/chat/session-controls/session-mode-control";
import { SessionControlIcon } from "@/components/session-controls/SessionControlIcon";

describe("SessionControlIcon", () => {
  it("renders every icon used by configured session controls", () => {
    const iconKeys = new Set<SessionControlIconKey>();

    for (const controlsByKey of Object.values(SESSION_CONTROL_PRESENTATIONS)) {
      for (const values of Object.values(controlsByKey)) {
        values?.forEach((value) => iconKeys.add(value.icon));
      }
    }

    expect(iconKeys.size).toBeGreaterThan(0);
    for (const icon of iconKeys) {
      const html = renderToStaticMarkup(
        createElement(SessionControlIcon, { icon, className: "size-4" }),
      );
      expect(html).toContain("<svg");
      expect(html).not.toContain("stroke=");
    }
  });

  it("uses distinct Claude mode icons", () => {
    expect(resolveConfiguredSessionControlValue("claude", "mode", "default")).toMatchObject({
      icon: "chat",
      shortLabel: "Default",
    });
    expect(resolveConfiguredSessionControlValue("claude", "mode", "acceptEdits")).toMatchObject({
      icon: "edit",
      label: "Accept Edits",
      shortLabel: "Edits",
    });
    expect(resolveConfiguredSessionControlValue("claude", "mode", "auto")).toMatchObject({
      icon: "sparkles",
      label: "Auto",
      shortLabel: "Auto",
      description: "Use a model classifier to approve or deny permission prompts.",
    });
    expect(resolveConfiguredSessionControlValue("claude", "mode", "plan")).toMatchObject({
      icon: "plan",
      shortLabel: "Plan",
    });
  });
});
