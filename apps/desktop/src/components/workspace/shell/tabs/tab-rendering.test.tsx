import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { buildDelegatedAgentIdentity } from "@/lib/domain/delegated-work/identity";
import type { DelegatedWorkTabIdentity } from "@/lib/domain/delegated-work/model";
import { getChatTabLabel, renderChatTabIcon } from "./tab-rendering";

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
    expect(html).toContain("data-chat-tab-icon-slot");
    expect(html).toContain("size-4");
    expect(html).not.toContain("data-jank-canary=\"braille\"");
  });

  it("keeps the same fixed-width icon slot while a tab starts working", () => {
    const idleHtml = renderToStaticMarkup(renderChatTabIcon({
      agentKind: "codex",
      viewState: "idle",
      isResolvingSession: false,
      delegatedAgent: null,
    }));
    const workingHtml = renderToStaticMarkup(renderChatTabIcon({
      agentKind: "codex",
      viewState: "working",
      isResolvingSession: false,
      delegatedAgent: null,
    }));

    expect(idleHtml).toContain("data-chat-tab-icon-slot");
    expect(workingHtml).toContain("data-chat-tab-icon-slot");
    expect(idleHtml).toContain("flex size-4 shrink-0 items-center justify-center");
    expect(workingHtml).toContain("flex size-4 shrink-0 items-center justify-center");
    expect(workingHtml).toContain("data-loading-spinner");
  });
});
