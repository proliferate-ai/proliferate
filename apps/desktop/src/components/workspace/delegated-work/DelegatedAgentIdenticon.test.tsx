import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { delegatedAgentIdenticonCells } from "@/lib/domain/delegated-work/identicon";
import { buildDelegatedAgentIdentity } from "@/lib/domain/delegated-work/identity";
import { DelegatedAgentIdenticon } from "./DelegatedAgentIdenticon";

describe("DelegatedAgentIdenticon", () => {
  const identity = buildDelegatedAgentIdentity({
    id: "link-explore-dotfiles",
    title: "explore-dotfiles",
    sessionId: "child-session",
    sessionLinkId: "link-explore-dotfiles",
  });

  it("renders one rect per lit identicon cell, tinted via currentColor", () => {
    const litCount = delegatedAgentIdenticonCells(identity.iconSeedHash)
      .flat()
      .filter(Boolean).length;
    const html = renderToStaticMarkup(
      <DelegatedAgentIdenticon
        identity={identity}
        className={`size-3.5 ${identity.textColorClassName}`}
      />,
    );

    expect(html.match(/<rect/gu)).toHaveLength(litCount);
    expect(html).toContain('fill="currentColor"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain(identity.textColorClassName);
  });

  it("renders the same markup for the same identity on every surface", () => {
    const first = renderToStaticMarkup(<DelegatedAgentIdenticon identity={identity} />);
    const second = renderToStaticMarkup(<DelegatedAgentIdenticon identity={identity} />);

    expect(second).toBe(first);
  });
});
