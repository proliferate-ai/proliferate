import type { ReactNode } from "react";
import { CircleAlert, FileCode } from "@proliferate/ui/icons";
import {
  GitReviewEmptyState,
  GitReviewEmptyStateAction,
} from "@/components/workspace/git/GitReviewEmptyState";

export function DiffDisplayPolicyPlaceholder({
  title,
  description,
  onOpenFile,
}: {
  title: string;
  description: string;
  onOpenFile: () => void;
}) {
  return (
    <GitReviewInlineEmptyState
      icon={<CircleAlert className="size-4" />}
      title={title}
      description={description}
      onOpenFile={onOpenFile}
    />
  );
}

export function GitReviewInlineEmptyState({
  icon,
  title,
  description,
  onOpenFile,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  onOpenFile?: () => void;
}) {
  return (
    <GitReviewEmptyState
      variant="inline"
      icon={icon}
      title={title}
      description={description}
      action={onOpenFile ? (
        <GitReviewEmptyStateAction onClick={onOpenFile}>
          Open file
        </GitReviewEmptyStateAction>
      ) : null}
    />
  );
}

export function formatEmptyDiffState({
  binary,
  truncated,
}: {
  binary: boolean;
  truncated: boolean;
}): {
  title: string;
  description: string;
  icon: ReactNode;
} | null {
  if (binary) {
    return {
      title: "Binary file changed",
      description: "Open the file to inspect this change.",
      icon: <FileCode className="size-3.5" />,
    };
  }
  if (truncated) {
    return {
      title: "Diff too large",
      description: "Open the file to inspect the full change.",
      icon: <CircleAlert className="size-3.5" />,
    };
  }
  return null;
}
