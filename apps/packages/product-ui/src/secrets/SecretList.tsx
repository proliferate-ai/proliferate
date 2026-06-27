import { SecretRow } from "./SecretRow";

export interface SecretListItem {
  id: string;
  label: string;
  detail: string;
}

export interface SecretListProps {
  emptyLabel: string;
  items: readonly SecretListItem[];
  canManage?: boolean;
  onEdit: (item: SecretListItem) => void;
  onDelete: (item: SecretListItem) => void;
}

export function SecretList({
  emptyLabel,
  items,
  canManage = true,
  onEdit,
  onDelete,
}: SecretListProps) {
  if (items.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border-light px-3 py-4 text-sm text-muted-foreground">
        {emptyLabel}
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
