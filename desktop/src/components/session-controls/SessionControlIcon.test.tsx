import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SESSION_CONTROL_PRESENTATIONS } from "@/lib/domain/chat/session-controls/presentation";
import type { SessionControlIconKey } from "@/lib/domain/chat/session-controls/presentation";
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
    }
  });
});
