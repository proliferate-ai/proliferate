import { KeyRound, Plus } from "lucide-react";

import { Button } from "@proliferate/ui/primitives/Button";
import { SecretRow } from "./SecretRow";

export interface SecretListItem {
  id: string;
  label: string;
  detail: string;
}

export interface SecretListProps {
  emptyLabel: string;
  emptyDescription?: string;
  addLabel?: string;
  onAdd?: () => void;
  items: readonly SecretListItem[];
  canManage?: boolean;
  onEdit: (item: SecretListItem) => void;
  onDelete: (item: SecretListItem) => void;
}

export function SecretList({
  emptyLabel,
  emptyDescription,
  addLabel = "Add secret",
  onAdd,
  items,
  canManage = true,
  onEdit,
  onDelete,
}: SecretListProps) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border-light px-4 py-6 text-center">
        <KeyRound size={16} className="text-muted-foreground" />
        <div className="space-y-0.5">
          <div className="text-sm text-foreground">{emptyLabel}</div>
          {emptyDescription ? (
            <div className="text-xs text-muted-foreground">{emptyDescription}</div>
          ) : null}
        </div>
        {canManage && onAdd ? (
          <Button type="button" variant="secondary" size="sm" onClick={onAdd}>
            <Plus size={14} />
            {addLabel}
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-border-light">
      {items.map((item) => (
        <SecretRow
          key={item.id}
          label={item.label}
          detail={item.detail}
          canManage={canManage}
          onEdit={() => onEdit(item)}
          onDelete={() => onDelete(item)}
        />
      ))}
    </div>
  );
}
