import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { buildDelegatedAgentIdentity } from "#product/lib/domain/delegated-work/identity";
import {
  AgentIdentityGlyph,
  type AgentIdentityGlyphDimension,
} from "./AgentIdentityGlyph";

describe("AgentIdentityGlyph", () => {
  const identity = buildDelegatedAgentIdentity({
    id: "subagent-explore-dotfiles",
    title: "explore-dotfiles",
    sessionId: "session-67e55044-10b1-426f-9247-bb680e5fe0c8",
    sessionLinkId: "link-explore-dotfiles",
  });

  it("renders the frozen Solid Seal silhouette and punched notch", () => {
    const html = renderToStaticMarkup(
      <AgentIdentityGlyph identity={identity} dimension={16} />,
    );

    expect(html).toContain('fill="currentColor"');
    expect(html).toContain("data-solid-seal-notch");
    expect(html).toContain('fill="var(--color-background)"');
    expect(html).toContain(`color:${identity.colorVar}`);
    expect(html).toContain('aria-hidden="true"');
  });

  it("ignores relationship-link identity when the durable session is unchanged", () => {
    const alternateLink = buildDelegatedAgentIdentity({
      id: "subagent-another-handle",
      title: "explore-dotfiles",
      sessionId: identity.sessionId,
      sessionLinkId: "link-recreated-after-close",
    });

    expect(
      renderToStaticMarkup(<AgentIdentityGlyph identity={alternateLink} dimension={16} />),
    ).toBe(
      renderToStaticMarkup(<AgentIdentityGlyph identity={identity} dimension={16} />),
    );
  });

  it("does not mint a glyph before a durable session ID exists", () => {
    const provisional = buildDelegatedAgentIdentity({
      id: "link-provisional-only",
      title: "explore-dotfiles",
      sessionLinkId: "link-provisional-only",
    });

    expect(renderToStaticMarkup(<AgentIdentityGlyph identity={provisional} />)).toBe("");
  });

  it("changes only dimensions at 12, 16, 18, and 20 pixels", () => {
    const sizes = [
      12,
      16,
      18,
      20,
    ] as const satisfies readonly AgentIdentityGlyphDimension[];
    const rendered = sizes.map((size) =>
      renderToStaticMarkup(<AgentIdentityGlyph identity={identity} dimension={size} />),
    );

    for (const [index, html] of rendered.entries()) {
      expect(html).toContain(`width="${sizes[index]}"`);
      expect(html).toContain(`height="${sizes[index]}"`);
    }
    expect(new Set(rendered.map(withoutDimensions)).size).toBe(1);
  });

  it("keeps an explicit dimension above a semantic size utility", () => {
    const html = renderToStaticMarkup(
      <AgentIdentityGlyph
        identity={identity}
        dimension={12}
        className="icon-control"
      />,
    );

    expect(html).toContain('class="shrink-0 icon-control"');
    expect(html).toContain('width="12" height="12"');
    expect(html).toContain("style=\"width:12px;height:12px;");
  });

  it("dims Closed without changing geometry or color", () => {
    const open = renderToStaticMarkup(
      <AgentIdentityGlyph identity={identity} dimension={18} />,
    );
    const closed = renderToStaticMarkup(
      <AgentIdentityGlyph identity={identity} dimension={18} closed />,
    );

    expect(open).toContain(`color:${identity.colorVar};opacity:1`);
    expect(closed).toContain(`color:${identity.colorVar};opacity:0.45`);
    expect(withoutOpacity(closed)).toBe(withoutOpacity(open));
    expect(closed).toContain(`color:${identity.colorVar}`);
  });
});

function withoutDimensions(markup: string): string {
  return markup
    .replace(/ width="(?:12|16|18|20)" height="(?:12|16|18|20)"/u, "")
    .replace(/width:(?:12|16|18|20)px;height:(?:12|16|18|20)px;/u, "");
}

function withoutOpacity(markup: string): string {
  return markup.replace(/opacity:(?:1|0\.45)/u, "opacity");
}
