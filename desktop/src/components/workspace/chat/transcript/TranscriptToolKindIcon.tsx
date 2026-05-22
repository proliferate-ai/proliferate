import {
  ClipboardList,
  FilePen,
  FilePlus,
  FileText,
  FolderList,
  Settings,
  Terminal,
} from "@/components/ui/icons";
import { ProliferateIcon } from "@/components/ui/proliferate-icons";
import type { ToolDisplayIconKey } from "@proliferate/product-model/chats/tools/tool-call-display";

export function ToolKindIcon({ iconKey }: { iconKey: ToolDisplayIconKey }) {
  const className = "size-3 text-faint";

  switch (iconKey) {
    case "terminal":
      return <Terminal className={className} />;
    case "folder-list":
      return <FolderList className={className} />;
    case "file-text":
      return <FileText className={className} />;
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
