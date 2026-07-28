import { LoadingState } from "@proliferate/ui";

// LoadingState is `h-full` and centers itself — with no bounded parent it
// collapses to nothing, so every cell gives it the pane height it fills in the
// product.
const PANE =
  "w-full max-w-2xl overflow-hidden rounded-xl border border-border";

export const WorkspaceBoot = () => (
  <div className={PANE} style={{ height: 320 }}>
    <LoadingState
      label="Starting your workspace"
      description="Cloning proliferate-ai/proliferate into a cloud sandbox. This takes about 20 seconds the first time."
    />
  </div>
);

export const FileViewer = () => (
  <div className={PANE} style={{ height: 260 }}>
    <LoadingState label="Loading file" description="MarkdownBody.tsx" />
  </div>
);

export const LabelOnly = () => (
  <div className={PANE} style={{ height: 220 }}>
    <LoadingState label="Checking your session" />
  </div>
);
