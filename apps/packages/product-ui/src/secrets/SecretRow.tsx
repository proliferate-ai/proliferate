import { Edit3, Trash2 } from "lucide-react";

import { Button } from "@proliferate/ui/primitives/Button";

export interface SecretRowProps {
  label: string;
  detail: string;
  canManage?: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

export function SecretRow({
  label,
  detail,
  canManage = true,
  onEdit,
  onDelete,
}: SecretRowProps) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border-light px-3 py-2 last:border-b-0">
      <div className="min-w-0">
        <div className="truncate font-mono text-sm text-foreground">{label}</div>
        <div className="truncate text-xs text-muted-foreground">{detail}</div>
      </div>
      {canManage ? (
        <div className="flex shrink-0 items-center gap-1">
          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Edit ${label}`} onClick={onEdit}>
            <Edit3 size={14} />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Delete ${label}`} onClick={onDelete}>
            <Trash2 size={14} />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
