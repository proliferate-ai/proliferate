import { Check, ChevronsUpDown, Cloud, Folder, Plus } from "lucide-react";
import { Button } from "@proliferate/ui/primitives/Button";
import {
  POPOVER_SURFACE_CLASS,
  PopoverButton,
} from "@proliferate/ui/primitives/PopoverButton";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";

export interface RepoPickerItem {
  id: string;
  name: string;
  detail?: string | null;
  kind: "local" | "cloud";
}

/**
 * Repo-scope header picker (design-system RepoPicker): bordered 200px trigger
 * with a `--special` folder chip, opening an elevated menu of repositories plus
 * an "Add repository…" footer. Defaults to the first repo when none is picked.
 */
export function RepoPicker({
  items,
  value,
  onSelect,
  onAddRepository,
}: {
  items: RepoPickerItem[];
  value: string | null;
  onSelect: (id: string) => void;
  onAddRepository: () => void;
}) {
  const selected = items.find((item) => item.id === value) ?? items[0] ?? null;
  return (
    <PopoverButton
      align="end"
      className={`w-60 ${POPOVER_SURFACE_CLASS}`}
      trigger={
        <Button
          type="button"
          variant="unstyled"
          size="unstyled"
          aria-label="Select repository"
          className="flex h-7 w-[200px] items-center gap-2 rounded-md border border-input bg-background pl-2 pr-2 text-ui-sm transition-colors hover:bg-accent data-[state=open]:bg-accent"
        >
          <RepoChip kind={selected?.kind ?? "local"} />
          <span className="min-w-0 flex-1 truncate text-left">
            {selected?.name ?? "Select repository"}
          </span>
          <ChevronsUpDown className="size-3 shrink-0 text-faint" />
        </Button>
      }
    >
      {(close) => (
        <>
          {items.map((item) => (
            <PopoverMenuItem
              key={item.id}
              icon={<RepoChip kind={item.kind} />}
              label={item.name}
              trailing={item.id === selected?.id
                ? <Check className="size-3 text-special" />
                : undefined}
              onClick={() => {
                onSelect(item.id);
                close();
              }}
            >
              {item.detail ?? undefined}
            </PopoverMenuItem>
          ))}
          <div className="mx-2 my-1 h-px shrink-0 bg-border-light" />
          <PopoverMenuItem
            icon={<Plus className="size-3.5" />}
            label="Add repository…"
            onClick={() => {
              onAddRepository();
              close();
            }}
          />
        </>
      )}
    </PopoverButton>
  );
}

function RepoChip({ kind }: { kind: RepoPickerItem["kind"] }) {
  const Icon = kind === "cloud" ? Cloud : Folder;
  return (
    <span className="flex size-[15px] shrink-0 items-center justify-center rounded bg-special text-white [&>svg]:size-[9px]">
      <Icon />
    </span>
  );
}
