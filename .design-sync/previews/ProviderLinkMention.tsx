import { ProviderLinkMention } from "@proliferate/ui";

/**
 * NOTE ON COVERAGE: for any host other than github.com the component resolves
 * `https://<host>/favicon.ico` over the network. The capture harness runs
 * offline, so a non-GitHub mention would photograph with its icon slot empty
 * (its documented final fallback) and prove nothing. Every cell below
 * therefore uses GitHub hosts — whose mark is an inline SVG — plus the
 * non-URL hrefs that take the plain-link branch. The favicon path is
 * UNVERIFIED by these sheets.
 */

/** Inline in an assistant turn, where the mention actually lives. */
export const InlineInATurn = () => (
  <div className="w-full max-w-2xl p-2 text-chat text-foreground">
    <p className="mb-3">
      I pushed the sidebar retune to{" "}
      <ProviderLinkMention href="https://github.com/proliferate/proliferate/pull/812">
        proliferate#812
      </ProviderLinkMention>{" "}
      and rebased it on <code className="text-markdown-inline-code">origin/main</code>. The
      failing check is the same one tracked in{" "}
      <ProviderLinkMention href="https://github.com/proliferate/proliferate/issues/774">
        issue #774
      </ProviderLinkMention>
      , so I left it alone for now.
    </p>
    <p>
      The retune spec lives at{" "}
      <ProviderLinkMention href="https://github.com/proliferate/proliferate/blob/main/specs/sidebar-retune.md">
        specs/sidebar-retune.md
      </ProviderLinkMention>{" "}
      if you want to check the round-4 notes before I open the follow-up.
    </p>
  </div>
);

/** A list of mentions: the icon sits on the text baseline at one line-height. */
export const MentionList = () => (
  <div className="flex w-full max-w-2xl flex-col gap-2 p-2 text-chat text-foreground">
    <ProviderLinkMention href="https://github.com/proliferate/proliferate/pull/812">
      Retune the desktop sidebar rows (round 4)
    </ProviderLinkMention>
    <ProviderLinkMention href="https://github.com/proliferate/cloud-control/pull/119">
      Enforce billing mode on workspace start
    </ProviderLinkMention>
    <ProviderLinkMention href="https://github.com/anyharness/anyharness/releases/tag/v0.14.0">
      anyharness v0.14.0
    </ProviderLinkMention>
    <ProviderLinkMention href="https://gist.github.com/pablo/8c1f0b2e">
      Repro gist for the worktree prune failure
    </ProviderLinkMention>
  </div>
);

/**
 * Non-URL hrefs (mailto:, #anchor, a relative file path) deliberately fall
 * back to the plain shared link treatment with no provider icon.
 */
export const NonUrlFallbacks = () => (
  <div className="w-full max-w-2xl p-2 text-chat text-foreground">
    <p className="mb-3">
      External link with a brand mark:{" "}
      <ProviderLinkMention href="https://github.com/proliferate/proliferate">
        github.com/proliferate/proliferate
      </ProviderLinkMention>
    </p>
    <p className="mb-3">
      Relative workspace path, no icon:{" "}
      <ProviderLinkMention href="apps/packages/product-ui/src/sidebar/ProductSidebarLayout.tsx">
        ProductSidebarLayout.tsx
      </ProviderLinkMention>
    </p>
    <p className="mb-3">
      In-page anchor, no icon:{" "}
      <ProviderLinkMention href="#round-4-notes">round-4 notes</ProviderLinkMention>
    </p>
    <p>
      Mail link, no icon:{" "}
      <ProviderLinkMention href="mailto:support@proliferate.dev">
        support@proliferate.dev
      </ProviderLinkMention>
    </p>
  </div>
);
