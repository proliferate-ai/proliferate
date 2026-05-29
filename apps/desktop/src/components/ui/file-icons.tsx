import { FileIcon } from "./icons";
import {
  FILE_ICON_ASSETS,
  FILE_ICON_TONES,
  type FileIconTone,
} from "./file-icon-assets";
import {
  getExpandedFileVisualKind,
  getFileVisual,
  type FileVisualKind,
} from "@/lib/domain/files/file-visuals";

function toneClass(tone: FileIconTone): string {
  switch (tone) {
    case "accent":
      return "text-file-icon-accent";
    case "folder":
      return "text-file-icon-folder";
    case "muted":
      return "text-file-icon-muted";
    case "neutral":
      return "text-file-icon-neutral";
    case "red":
      return "text-file-icon-red";
    default:
      return "text-file-icon-neutral";
  }
}

function renderVisual(
  kind: FileVisualKind,
  className: string,
  toneClassName?: string,
) {
  const iconSvg = FILE_ICON_ASSETS[kind];
  const tone = FILE_ICON_TONES[kind] ?? "neutral";
  const colorClassName = toneClassName ?? toneClass(tone);

  if (!iconSvg) {
    return <FileIcon aria-hidden="true" className={`${className} ${colorClassName}`} />;
  }

  return (
    <span
      aria-hidden="true"
      className={`${className} ${colorClassName} inline-block pointer-events-none select-none [&>svg]:block [&>svg]:size-full`}
      dangerouslySetInnerHTML={{ __html: iconSvg }}
    />
  );
}

export function FileTreeEntryIcon({
  name,
  path,
  kind,
  isExpanded,
  className = "size-3.5 shrink-0",
  toneClassName,
}: {
  name: string;
  path: string;
  kind: string;
  isExpanded?: boolean;
  className?: string;
  toneClassName?: string;
}) {
  const visual = getFileVisual(name, path, kind);
  const resolvedKind = isExpanded
    ? getExpandedFileVisualKind(visual.kind)
    : visual.kind;

  return renderVisual(resolvedKind, className, toneClassName);
}
