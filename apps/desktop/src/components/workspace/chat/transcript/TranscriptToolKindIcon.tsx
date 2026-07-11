import {
  ClipboardList,
  CommandWindow,
  FilePen,
  FilePlus,
  FolderList,
  ReadBook,
  Settings,
} from "@proliferate/ui/icons";
import { ProliferateIcon } from "@proliferate/ui/proliferate-icons";
import type { ToolDisplayIconKey } from "@proliferate/product-domain/chats/tools/tool-call-display";

export function ToolKindIcon({ iconKey }: { iconKey: ToolDisplayIconKey }) {
  const className = "size-4 text-muted-foreground";

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
