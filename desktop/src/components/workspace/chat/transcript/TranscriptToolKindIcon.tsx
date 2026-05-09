import { ClipboardList, Settings, Terminal } from "@/components/ui/icons";
import { FilePen, FilePlus, FileText, FolderList } from "@/components/ui/file-icons";
import { ProliferateIcon } from "@/components/ui/proliferate-icons";
import type { ToolDisplayIconKey } from "@/lib/domain/chat/tools/tool-call-display";

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
