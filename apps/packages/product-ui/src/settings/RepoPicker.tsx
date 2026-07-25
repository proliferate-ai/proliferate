import { Check, ChevronsUpDown, Cloud, Plus } from "lucide-react";
import { GitHub } from "@proliferate/ui/icons";
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
 * Repo-scope header picker: compact outline trigger opening an elevated menu
 * of repositories plus an "Add repository…" footer. Defaults to the first repo
 * when none is picked.
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
          variant="outline"
          size="sm"
          aria-label="Select repository"
          className="h-[30px] w-52 justify-start gap-2 px-2 text-ui font-normal text-foreground data-[state=open]:bg-accent"
        >
          <RepoChip kind={selected?.kind ?? "local"} />
          <span className="min-w-0 flex-1 truncate text-left">
            {selected?.name ?? "Select repository"}
          </span>
          <ChevronsUpDown className="icon-paired shrink-0 text-faint" />
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
                ? <Check className="icon-paired text-special" />
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
            icon={<Plus className="icon-paired" />}
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
  // GitHub-backed repos read as a GitHub mark; cloud environments stay a
  // Cloud glyph.
  const Icon = kind === "cloud" ? Cloud : GitHub;
  return (
    <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground [&>svg]:icon-compact">
      <Icon />
    </span>
  );
}
