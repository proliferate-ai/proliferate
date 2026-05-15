import type { ReadWorkspaceFileResponse } from "@anyharness/sdk";
import { LoadingState } from "@/components/feedback/LoadingIllustration";
import { MarkdownRenderer } from "@/components/ui/content/MarkdownRenderer";
import { CenterMessage } from "@/components/workspace/files/viewer/CenterMessage";
import { FileDiffPane } from "@/components/workspace/files/viewer/FileDiffPane";
import { FileSourceView } from "@/components/workspace/files/viewer/FileSourceView";
import { canPreviewAsSvg } from "@/lib/domain/files/document-preview";
import type { FileDiffTarget } from "@/lib/domain/workspaces/viewer/file-diff-options";
import type { FileViewerMode } from "@/lib/domain/workspaces/viewer/viewer-target";

interface FileViewerContentProps {
  filePath: string;
  workspaceId: string | null;
  effectiveMode: FileViewerMode;
  read: ReadWorkspaceFileResponse | undefined;
  activeDiffTarget: FileDiffTarget | null;
  diffLayout: "unified" | "split";
  canShowRichPreview: boolean;
  wordWrap: boolean;
}

export function FileViewerContent({
  filePath,
  workspaceId,
  effectiveMode,
  read,
  activeDiffTarget,
  diffLayout,
  canShowRichPreview,
  wordWrap,
}: FileViewerContentProps) {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {effectiveMode === "diff" && activeDiffTarget ? (
        <FileDiffPane
          workspaceId={workspaceId}
          target={activeDiffTarget}
          layout={diffLayout}
        />
      ) : !read ? (
        <div className="flex h-full min-h-0 min-w-0 items-center justify-center overflow-hidden">
          <LoadingState message="Loading file" subtext={filePath.split("/").pop()} />
        </div>
      ) : read.tooLarge ? (
        <CenterMessage message={`${filePath} is too large to display`} />
      ) : !read.isText ? (
        <CenterMessage message={`${filePath} is a binary file and cannot be previewed yet`} />
      ) : effectiveMode === "rendered" && canShowRichPreview ? (
        <RichPreview filePath={filePath} content={read.content ?? ""} />
      ) : (
        <FileSourceView
          code={read.content ?? ""}
          filePath={filePath}
          wordWrap={wordWrap}
        />
      )}
    </div>
  );
}

function RichPreview({
  filePath,
  content,
}: {
  filePath: string;
  content: string;
}) {
  if (canPreviewAsSvg(filePath)) {
    return (
      <div className="flex h-full min-h-0 min-w-0 items-center justify-center overflow-auto bg-background p-6">
        <img
          alt={filePath}
          src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}`}
          className="max-h-full max-w-full"
        />
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 min-w-0 overflow-auto bg-background px-8 py-6">
      <MarkdownRenderer content={content} />
    </div>
  );
}
