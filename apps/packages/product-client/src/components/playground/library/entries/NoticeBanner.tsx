import { NoticeBanner } from "#product/primitives/patterns/NoticeBanner";
import { Button } from "#product/primitives/Button";
import { CircleAlert } from "#product/primitives/icons/status";
import type { LibraryEntry } from "../types";

/**
 * Self-contained spec-sheet demo: fixture props and no state, per the registry
 * contract in DESIGN_SYSTEM.md ("How to add a component", step 5). Splice
 * `NOTICE_BANNER_ENTRY` into `PATTERNS_ENTRIES` in alphabetical position.
 */
function NoticeBannerDemo() {
  return (
    <div className="flex w-full max-w-lg flex-col gap-2">
      <NoticeBanner tone="neutral">
        Sessions keep running while this pane is closed.
      </NoticeBanner>
      <NoticeBanner
        tone="info"
        title="Unclaimed session"
        action={<Button variant="secondary" size="sm">Claim</Button>}
      >
        Claim this session to send messages.
      </NoticeBanner>
      <NoticeBanner
        tone="warning"
        icon={<CircleAlert />}
        title="This workflow cannot run yet"
      >
        Two steps reference an agent that is not installed.
      </NoticeBanner>
      <NoticeBanner tone="destructive">
        Secret could not be saved. Check the value and try again.
      </NoticeBanner>
    </div>
  );
}

export const NOTICE_BANNER_ENTRY: LibraryEntry = {
  name: "NoticeBanner",
  subpath: "#product/primitives/patterns/NoticeBanner",
  render: NoticeBannerDemo,
};
