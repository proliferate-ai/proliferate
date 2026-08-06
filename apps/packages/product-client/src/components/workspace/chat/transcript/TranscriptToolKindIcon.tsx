import { ClipboardList } from "#product/primitives/icons/product";
import {
  CommandWindow,
  FilePen,
  FilePlus,
  FolderList,
  ReadBook,
} from "#product/primitives/icons/workspace";
import { Settings } from "#product/primitives/icons/core";
import { ProliferateIcon } from "#product/primitives/icons/proliferate-icons";
import type { ToolDisplayIconKey } from "#product/domain/chats/tools/tool-call-display";

export function ToolKindIcon({ iconKey }: { iconKey: ToolDisplayIconKey }) {
  const className = "icon-paired text-current";

  switch (iconKey) {
    case "terminal":
      return <CommandWindow className={className} />;
    case "folder-list":
      return <FolderList className={className} />;
    case "file-text":
      return <ReadBook className={className} />;
    case "file-plus":
      return <FilePlus className={className} />;
    case "file-pen":
      return <FilePen className={className} />;
    case "clipboard-list":
      return <ClipboardList className={className} />;
    case "proliferate":
      return <ProliferateIcon className={className} />;
    case "settings":
    default:
      return <Settings className={className} />;
  }
}
