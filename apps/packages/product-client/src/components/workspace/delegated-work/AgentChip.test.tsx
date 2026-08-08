import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { buildDelegatedAgentIdentity } from "#product/lib/domain/delegated-work/identity";
import { AgentChip } from "./AgentChip";

const identity = buildDelegatedAgentIdentity({
  id: "link-audit",
  title: "Audit retry queue schema",
  sessionId: "sess_a9f2c41d",
  sessionLinkId: "link-audit",
});

describe("AgentChip", () => {
  it("renders the locked chip anatomy: 28px pill, 16px seal, 288px truncation", () => {
    const html = renderToStaticMarkup(<AgentChip identity={identity} onOpen={() => {}} />);

    // Spawn Receipts canvas: h-7 pill · border-light on surface-elevated ·
    // 16px glyph · task-derived name truncating at max-w-72 (288px).
    expect(html).toContain("h-7");
    expect(html).toContain("max-w-72");
    expect(html).toContain("rounded-full");
    expect(html).toContain("border-border-light");
    expect(html).toContain("bg-surface-elevated");
    expect(html).toContain("icon-paired");
    expect(html).toContain("truncate");
    // The visible name is the task, not the "Name (task shortid)" tab label —
    // that longer form stays on hover only.
    expect(html).toContain(">Audit retry queue schema</span>");
    expect(html).not.toContain(`>${identity.displayName}<`);
    expect(html).toContain(`title="${identity.displayName}"`);
  });

  it("tints the name with the agent's colour token", () => {
    const html = renderToStaticMarkup(<AgentChip identity={identity} />);

    expect(html).toContain(identity.textColorClassName);
    // No new colour tokens: the tint is the delegated-agent token off identity.
    expect(identity.textColorClassName).toMatch(/^text-delegated-agent-[1-8]$/u);
  });

  it("opens the agent when it can be opened, and stays static text when it cannot", () => {
    const openable = renderToStaticMarkup(<AgentChip identity={identity} onOpen={() => {}} />);
    const staticChip = renderToStaticMarkup(<AgentChip identity={identity} />);

    expect(openable).toContain("<button");
    expect(openable).toContain('aria-label="Open Audit retry queue schema"');
    expect(staticChip).not.toContain("<button");
  });

  it("rides the mono short id as a faint suffix only when addressed by id", () => {
    const byId = renderToStaticMarkup(<AgentChip identity={identity} showShortId />);
    const byLink = renderToStaticMarkup(<AgentChip identity={identity} />);

    expect(byId).toContain(identity.shortId);
    expect(byId).toContain("font-mono");
    expect(byId).toContain("text-faint");
    expect(byLink).not.toContain("font-mono");
  });

  it("dims a closed agent — muted text, dimmed glyph, transparent fill — and keeps it clickable", () => {
    const html = renderToStaticMarkup(
      <AgentChip identity={identity} dimmed onOpen={() => {}} />,
    );

    expect(html).toContain("bg-transparent");
    expect(html).toContain("text-muted-foreground");
    expect(html).toContain("text-muted-foreground/50");
    // Dimmed drops the colour tint entirely — closed agents are not tinted.
    expect(html).not.toContain(identity.textColorClassName);
    // Closed chips stay clickable forever: they open the read-only transcript.
    expect(html).toContain("<button");
  });
});
