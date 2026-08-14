// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { buildDelegatedAgentIdentity } from "#product/lib/domain/delegated-work/identity";
import type { DelegatedWorkTabIdentity } from "#product/lib/domain/delegated-work/model";
import {
  getChatTabLabel,
  renderChatTabIcon,
  renderChatTabStatusBadge,
} from "#product/components/workspace/shell/tabs/tab-rendering";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("getChatTabLabel", () => {
  it("uses only the generated agent name for delegated header tabs", () => {
    const delegatedAgent: DelegatedWorkTabIdentity = {
      identity: buildDelegatedAgentIdentity({
        id: "link-explore-dotfiles",
        title: "explore-dotfiles",
        sessionId: "child-session",
        sessionLinkId: "link-explore-dotfiles",
      }),
      kind: "subagent",
      originLabel: "Subagent",
      statusCategory: "running",
      statusLabel: "Working",
      parentTitle: "Parent",
      hoverTitle: "Subagent",
    };

    expect(getChatTabLabel({
      title: "explore-dotfiles",
      delegatedAgent,
    })).toBe(delegatedAgent.identity.generatedName);
    expect(getChatTabLabel({
      title: "explore-dotfiles",
      delegatedAgent,
    })).not.toContain("explore-dotfiles");
  });

  it("uses the session title for normal header tabs", () => {
    expect(getChatTabLabel({
      title: "Main session",
      delegatedAgent: null,
    })).toBe("Main session");
  });
});

describe("renderChatTabIcon", () => {
  it("renders a skeleton block for resolving chat sessions", () => {
    const html = renderToStaticMarkup(renderChatTabIcon({
      agentKind: "",
      viewState: "idle",
      isResolvingSession: true,
      delegatedAgent: null,
    }));

    expect(html).toContain("bg-muted");
    expect(html).not.toContain("data-jank-canary=\"braille\"");
  });

  it("dims a Closed delegated identity without changing its glyph", () => {
    const identity = buildDelegatedAgentIdentity({
      id: "link-closed-agent",
      title: "Closed agent",
      sessionId: "session-closed-agent",
    });
    const baseAgent = {
      identity,
      kind: "subagent",
      originLabel: "Subagent",
      statusLabel: "Done",
      parentTitle: "Parent",
      hoverTitle: "Subagent",
    } as const;
    const tab = {
      agentKind: "claude",
      viewState: "idle",
      isResolvingSession: false,
    } as const;

    const openGlyph = extractSvg(renderToStaticMarkup(renderChatTabIcon({
      ...tab,
      delegatedAgent: { ...baseAgent, statusCategory: "finished" },
    })));
    const closedGlyph = extractSvg(renderToStaticMarkup(renderChatTabIcon({
      ...tab,
      delegatedAgent: { ...baseAgent, statusCategory: "closed" },
    })));

    expect(openGlyph).toContain("opacity:1");
    expect(closedGlyph).toContain("opacity:0.45");
    expect(closedGlyph.replace("opacity:0.45", "opacity"))
      .toBe(openGlyph.replace("opacity:1", "opacity"));
  });
});

describe("renderChatTabStatusBadge", () => {
  it("uses the breathe cell only for waiting-on-input state", () => {
    const html = renderToStaticMarkup(renderChatTabStatusBadge({
      id: "waiting-session",
      viewState: "needs_input",
      hasUnreadActivity: false,
    }));

    expect(html).toContain('data-variant="breathe"');
    expect(html).toContain('aria-label="Waiting for input"');
  });

  it("keeps one randomized loader variant for a run and chooses again next run", () => {
    vi.spyOn(Math, "random")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.99);

    const { container, rerender } = render(
      <>
        {renderChatTabStatusBadge({
          id: "running-session",
          viewState: "working",
          hasUnreadActivity: false,
        })}
        {renderChatTabStatusBadge({
          id: "running-session",
          viewState: "working",
          hasUnreadActivity: false,
        })}
      </>,
    );
    expect(
      Array.from(container.querySelectorAll("[data-dot-cell-loader]"), (loader) => (
        loader.getAttribute("data-variant")
      )),
    ).toEqual(["wave", "wave"]);
    expect(Math.random).toHaveBeenCalledTimes(1);

    rerender(
      <>{renderChatTabStatusBadge({
        id: "running-session",
        viewState: "working",
        hasUnreadActivity: true,
      })}</>,
    );
    expect(container.querySelector("[data-dot-cell-loader]")?.getAttribute("data-variant"))
      .toBe("wave");

    rerender(<>{renderChatTabStatusBadge({
      id: "running-session",
      viewState: "idle",
      hasUnreadActivity: false,
    })}</>);
    rerender(
      <>{renderChatTabStatusBadge({
        id: "running-session",
        viewState: "working",
        hasUnreadActivity: false,
      })}</>,
    );
    expect(container.querySelector("[data-dot-cell-loader]")?.getAttribute("data-variant"))
      .toBe("helix");
  });
});

function extractSvg(markup: string): string {
  const svg = markup.match(/<svg\b[\s\S]*?<\/svg>/u)?.[0];
  if (!svg) {
    throw new Error("Expected rendered delegated-agent SVG");
  }
  return svg;
}
