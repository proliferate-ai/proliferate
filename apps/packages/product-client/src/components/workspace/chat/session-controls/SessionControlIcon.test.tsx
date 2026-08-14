import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SESSION_CONTROL_PRESENTATIONS } from "#product/lib/domain/chat/session-controls/presentation";
import type { SessionControlIconKey } from "#product/lib/domain/chat/session-controls/presentation";
import { resolveConfiguredSessionControlValue } from "#product/lib/domain/chat/session-controls/session-mode-control";
import { SessionControlIcon } from "#product/components/workspace/chat/session-controls/SessionControlIcon";

/**
 * The session-control family is filled, with one ruled exception: the plan
 * mode's folded map is an outline glyph (stroke 1.6, fill none) because its
 * fold seams ARE the drawing — a filled map is a blob. Ruled in the composer
 * cleanup design contract; every other key must stay filled.
 */
const OUTLINE_ICON_KEYS = new Set<SessionControlIconKey>(["plan"]);

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
      if (OUTLINE_ICON_KEYS.has(icon)) {
        expect(html).toContain("stroke=\"currentColor\"");
        expect(html).toContain("fill=\"none\"");
      } else {
        expect(html).not.toContain("stroke=");
      }
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
