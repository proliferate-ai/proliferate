import {
  AutoHideScrollArea,
  Badge,
  FileCode,
  FileText,
  Folder,
  UserAvatar,
} from "@proliferate/ui";

const FILES = [
  { name: "ComposerTextarea.tsx", path: "patterns" },
  { name: "ComposerControlButton.tsx", path: "patterns" },
  { name: "AutoHideScrollArea.tsx", path: "patterns" },
  { name: "AlertDialog.tsx", path: "primitives" },
  { name: "Command.tsx", path: "primitives" },
  { name: "Checkbox.tsx", path: "primitives" },
  { name: "AnimatedSwapText.tsx", path: "primitives" },
  { name: "Button.tsx", path: "primitives" },
  { name: "Badge.tsx", path: "primitives" },
  { name: "Select.tsx", path: "primitives" },
];

const TRANSCRIPT = [
  {
    who: "Pablo",
    text: "Port the playground registry compositions into design-sync previews.",
  },
  {
    who: "Agent",
    text: "Reading apps/packages/product-client/src/components/playground/library — 72 sanctioned entries across four tiers.",
  },
  {
    who: "Agent",
    text: "Authored 10 preview files. Rebuilding _preview/*.js for the batch, then capturing sheets at 900×700.",
  },
  {
    who: "Pablo",
    text: "Grade every cell before you report back.",
  },
  {
    who: "Agent",
    text: "Captured. AlertDialog renders open over the overlay; Command needs a sized wrapper so the list can scroll.",
  },
];

export const FileTreeSidebar = () => (
  <div className="flex h-64 w-72 flex-col rounded-lg border border-border bg-surface-elevated">
    <div className="flex items-center gap-2 border-b border-border px-3 py-2">
      <Folder className="icon-paired text-muted-foreground" />
      <span className="text-ui text-foreground">apps/packages/ui/src</span>
    </div>
    <AutoHideScrollArea className="min-h-0 flex-1" viewportClassName="px-2 py-2">
      <div className="flex flex-col gap-px">
        {FILES.map((file) => (
          <div
            key={`${file.path}/${file.name}`}
            className="flex items-center gap-2 rounded-md px-2 py-1"
          >
            <FileCode className="icon-paired text-muted-foreground" />
            <span className="truncate text-ui-sm text-foreground">{file.name}</span>
            <span className="ml-auto shrink-0 text-ui-sm text-muted-foreground">
              {file.path}
            </span>
          </div>
        ))}
      </div>
    </AutoHideScrollArea>
  </div>
);

export const TranscriptScroll = () => (
  <div className="flex h-64 w-96 flex-col rounded-lg border border-border bg-surface-elevated">
    <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
      <span className="text-ui text-foreground">design-sync-ui-import</span>
      <Badge tone="success">running</Badge>
    </div>
    <AutoHideScrollArea className="min-h-0 flex-1" viewportClassName="px-3 py-3">
      <div className="flex flex-col gap-3">
        {TRANSCRIPT.map((entry, index) => (
          <div key={index} className="flex gap-2">
            <UserAvatar displayName={entry.who} className="size-6 shrink-0" />
            <div className="min-w-0">
              <div className="text-chat-meta text-muted-foreground">{entry.who}</div>
              <p className="text-chat text-foreground">{entry.text}</p>
            </div>
          </div>
        ))}
      </div>
    </AutoHideScrollArea>
  </div>
);

export const HorizontalLogs = () => (
  <div className="flex h-40 w-96 flex-col rounded-lg border border-border bg-surface-elevated">
    <div className="flex items-center gap-2 border-b border-border px-3 py-2">
      <FileText className="icon-paired text-muted-foreground" />
      <span className="text-ui text-foreground">build.log</span>
    </div>
    <AutoHideScrollArea
      allowHorizontal
      className="min-h-0 flex-1"
      viewportClassName="px-3 py-2"
    >
      <pre className="text-readable-code text-foreground">
{`[12:04:01] pnpm -F "@proliferate/product-ui..." build — resolved 4 workspace packages
[12:04:09] tsc -p tsconfig.build.json → 73 entry points, 0 errors
[12:04:12] tailwindcss -i .design-sync/css/ds-source.css -o apps/packages/ui/.ds-compiled.css
[12:04:14] wrote 485 KB (276 live tokens, 45 @font-face rules, 15 urls rewritten)
[12:04:15] done in 14.2s`}
      </pre>
    </AutoHideScrollArea>
  </div>
);
