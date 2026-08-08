import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { buildDelegatedAgentIdentity, mixHash } from "#product/lib/domain/delegated-work/identity";
import { DelegatedAgentIdenticon } from "./DelegatedAgentIdenticon";

describe("DelegatedAgentIdenticon", () => {
  const identity = buildDelegatedAgentIdentity({
    id: "link-explore-dotfiles",
    title: "explore-dotfiles",
    sessionId: "child-session",
    sessionLinkId: "link-explore-dotfiles",
  });

  it("renders the seal with a punched notch, tinted via currentColor", () => {
    const html = renderToStaticMarkup(
      <DelegatedAgentIdenticon
        identity={identity}
        className={`size-3.5 ${identity.textColorClassName}`}
      />,
    );

    // The notch is a genuine mask cut-out, not a background-colored dot: the
    // glyph must stay punched on any surface it lands on.
    expect(html).toContain("<mask");
    expect(html).toContain('fill="black"');
    expect(html).not.toContain("var(--color-background)");
    expect(html).toContain('fill="currentColor"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain(identity.textColorClassName);
  });

  it("derives shape and notch position from the mixed seed hash", () => {
    const mixed = mixHash(identity.iconSeedHash);
    const angle = (((mixed >>> 2) % 8) * 45 * Math.PI) / 180;
    const notchX = 12 + 4.1 * Math.cos(angle);
    const notchY = 12 + 4.1 * Math.sin(angle);
    const html = renderToStaticMarkup(<DelegatedAgentIdenticon identity={identity} />);

    expect(html).toContain(`cx="${notchX}"`);
    expect(html).toContain(`cy="${notchY}"`);
  });

  it("renders the same markup for the same identity on every surface", () => {
    const first = renderToStaticMarkup(<DelegatedAgentIdenticon identity={identity} />);
    const second = renderToStaticMarkup(<DelegatedAgentIdenticon identity={identity} />);

    expect(second).toBe(first);
  });

  it("gives different identities different seals", () => {
    const other = buildDelegatedAgentIdentity({
      id: "link-schema-audit",
      title: "schema-audit",
      sessionId: "other-session",
      sessionLinkId: "link-schema-audit",
    });
    const first = renderToStaticMarkup(<DelegatedAgentIdenticon identity={identity} />);
    const second = renderToStaticMarkup(<DelegatedAgentIdenticon identity={other} />);

    expect(second).not.toBe(first);
  });
});
