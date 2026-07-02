import { ChevronDown } from "lucide-react";
import { Input } from "@proliferate/ui/primitives/Input";
import { useRef, useState } from "react";
import { ComposerControlButton } from "@proliferate/ui/primitives/ComposerControlButton";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import {
  filterModelControlOptions,
  isControlDisabled,
  isModelControl,
  modelConfigSubmenuLabel,
  modelGroupLabel,
  selectedComposerOption,
  summarizeComposerModelConfigControls,
} from "./CloudChatComposerControlModel";
import {
  ComposerControlMenuRows,
  ComposerMenuSeparator,
  PendingComposerConfigIndicator,
  iconNodeForComposerControl,
} from "./CloudChatComposerControlParts";
import type { CloudChatComposerControlView } from "./CloudChatComposerView";
import { ComposerPopoverSurface } from "./ComposerPopoverSurface";
import { useDismissComposerPopover } from "./useDismissComposerPopover";

export function CloudChatModelConfigControl({
  controls,
  composerDisabled = false,
}: {
  controls: readonly CloudChatComposerControlView[];
  composerDisabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeSubmenuId, setActiveSubmenuId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const modelControl = controls.find((control) => isModelControl(control)) ?? controls[0] ?? null;
  const configControls = controls.filter((control) => control !== modelControl);
  const selectedModel = modelControl ? selectedComposerOption(modelControl) : null;
  const filteredModelControl = modelControl
    ? filterModelControlOptions(modelControl, search)
    : null;
  const activeConfigSubmenuControl = configControls.find((control) => control.id === activeSubmenuId) ?? null;
  const showSubmenuRows = configControls.length > 0;
  const pendingState = controls.find((control) => control.pendingState)?.pendingState ?? null;
  const disabled = composerDisabled || controls.every(isControlDisabled);
  const triggerLabel = selectedModel?.label ?? modelControl?.detail ?? modelControl?.label ?? "Configure";
  const triggerDetail = summarizeComposerModelConfigControls(configControls);

  function closePopover() {
    setOpen(false);
    setSearch("");
    setActiveSubmenuId(null);
  }

  useDismissComposerPopover(open, rootRef, closePopover);

  return (
    <div ref={rootRef} className="relative min-w-0">
      <ComposerControlButton
        disabled={disabled}
        icon={iconNodeForComposerControl(selectedModel?.icon ?? modelControl?.icon ?? "claude", "size-4")}
        label={triggerLabel}
        detail={triggerDetail}
        trailing={(
          <span className="flex items-center gap-1">
            <PendingComposerConfigIndicator pendingState={pendingState} />
            <ChevronDown
              size={12}
              className="shrink-0 text-[color:var(--color-composer-control-muted-foreground)]"
            />
          </span>
        )}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Model and configuration: ${triggerLabel}${triggerDetail ? `, ${triggerDetail}` : ""}`}
        data-state={open ? "open" : "closed"}
        className="max-w-[18rem]"
        onClick={() => {
          setOpen((value) => {
            const nextOpen = !value;
            if (!nextOpen) {
              setSearch("");
              setActiveSubmenuId(null);
            }
            return nextOpen;
          });
        }}
      />
      {open && !disabled ? (
        <div
          className="absolute bottom-full right-0 z-[80] mb-1"
          onMouseLeave={() => setActiveSubmenuId(null)}
        >
          <ComposerPopoverSurface className="w-72 max-w-[calc(100vw-1rem)] p-1">
            <div className="flex max-h-[min(20rem,calc(100vh-8rem))] min-h-0 flex-col">
              {modelControl ? (
                <ComposerModelPickerMenu
                  control={filteredModelControl ?? modelControl}
                  search={search}
                  onSearchChange={setSearch}
                  onClose={() => {
                    setOpen(false);
                    setSearch("");
                    setActiveSubmenuId(null);
                  }}
                />
              ) : null}
              {showSubmenuRows ? (
                <div className="shrink-0">
                  <ComposerMenuSeparator />
                  {configControls.map((control) => (
                    <ComposerConfigSubmenuButton
                      key={control.id}
                      active={activeSubmenuId === control.id}
                      control={control}
                      onOpen={() => setActiveSubmenuId(control.id)}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          </ComposerPopoverSurface>
          {activeConfigSubmenuControl ? (
            <ComposerPopoverSurface className="absolute bottom-0 left-[calc(100%+0.25rem)] z-[81] w-56 max-w-[calc(100vw-1rem)] p-1">
              <ComposerControlMenuRows
                control={activeConfigSubmenuControl}
                onClose={() => {
                  setOpen(false);
                  setSearch("");
                  setActiveSubmenuId(null);
                }}
              />
            </ComposerPopoverSurface>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ComposerModelPickerMenu({
  control,
  search,
  onSearchChange,
  onClose,
}: {
  control: CloudChatComposerControlView;
  search: string;
  onSearchChange: (value: string) => void;
  onClose: () => void;
}) {
  const hasModelOptions = control.groups.some((group) => group.options.length > 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col space-y-1">
      <div className="space-y-1">
        <div className="px-1">
          <div className="flex h-7 items-center rounded-lg border border-border bg-surface-control px-2.5">
            <Input
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search models"
              className="h-auto min-w-0 border-0 bg-transparent px-0 py-0 text-sm shadow-none focus:ring-0"
              data-telemetry-mask
            />
          </div>
        </div>
      </div>
      <div className="min-h-0 max-h-[11rem] overflow-y-auto">
        {control.groups.map((group, index) => (
          <div key={group.id}>
            {index > 0 ? <ComposerMenuSeparator /> : null}
            {modelGroupLabel(control, group) ? (
              <div className="min-h-5 truncate px-2 py-0.5 text-sm font-[430] leading-4 text-muted-foreground/70">
                {modelGroupLabel(control, group)}
              </div>
            ) : null}
            <ComposerControlMenuRows
              control={{ ...control, groups: [group] }}
              showDescriptions={!isModelControl(control)}
              onClose={onClose}
            />
          </div>
        ))}
        {!hasModelOptions ? (
          <p className="px-3 py-4 text-center text-sm text-muted-foreground">
            No models matching "{search}"
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ComposerConfigSubmenuButton({
  active,
  control,
  onOpen,
}: {
  active: boolean;
  control: CloudChatComposerControlView;
  onOpen: () => void;
}) {
  return (
    <PopoverMenuItem
      label={modelConfigSubmenuLabel(control)}
      trailing={<ChevronDown className="-rotate-90 size-3.5 shrink-0" />}
      className={active ? "bg-list-hover text-popover-foreground" : ""}
      aria-haspopup="menu"
      aria-expanded={active}
      data-state={active ? "open" : "closed"}
      onClick={onOpen}
      onFocus={onOpen}
      onMouseEnter={onOpen}
    />
  );
}
