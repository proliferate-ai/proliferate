import { useMemo, useState, type ReactNode } from "react";

import { Button } from "@proliferate/ui/primitives/Button";
import { Textarea } from "@proliferate/ui/primitives/Textarea";

export interface PickerItemView {
  id: string;
  label: string;
  description?: string;
  icon?: ReactNode;
  disabled?: boolean;
  selected?: boolean;
}

export interface PickerGroupView {
  id: string;
  label?: string;
  items: PickerItemView[];
}

export interface PickerView {
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  groups: PickerGroupView[];
}

export interface NoticeView {
  id: string;
  tone: "neutral" | "warning" | "error";
  text: string;
  action?: {
    label: string;
    loading?: boolean;
    disabled?: boolean;
    onClick: () => void;
  };
}

export interface ActionRowView {
  id: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  loading?: boolean;
}

export type NewChatPickerId = "target" | "model" | "mode";

export interface NewChatSurfaceProps {
  heading: string;
  draft: string;
  placeholder: string;
  canSubmit: boolean;
  submitting: boolean;
  target: PickerView;
  model: PickerView;
  mode: PickerView;
  notices: NoticeView[];
  actions: ActionRowView[];
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
  onCancel?: () => void;
  onPickerSelect?: (picker: NewChatPickerId, itemId: string) => void;
  onAction?: (id: string) => void;
}

export function NewChatSurface({
  heading,
  draft,
  placeholder,
  canSubmit,
  submitting,
  target,
  model,
  mode,
  notices,
  actions,
  onDraftChange,
  onSubmit,
  onCancel,
  onPickerSelect,
  onAction,
}: NewChatSurfaceProps) {
  return (
    <div className="web-scrollbar h-full overflow-y-auto bg-background text-foreground">
      <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-center px-6 py-12">
        <header className="mb-8 text-center">
          <h1 className="text-2xl font-semibold text-foreground">{heading}</h1>
        </header>

        <div className="rounded-xl border border-border bg-card shadow-floating">
          <Textarea
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            className="min-h-32 w-full resize-none border-0 bg-transparent px-4 py-4 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground focus:ring-0"
            placeholder={placeholder}
          />

          <div className="border-t border-border-light px-3 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <PickerButton pickerId="target" picker={target} onPickerSelect={onPickerSelect} />
              <PickerButton pickerId="model" picker={model} onPickerSelect={onPickerSelect} />
              <PickerButton pickerId="mode" picker={mode} onPickerSelect={onPickerSelect} />

              <div className="ml-auto flex items-center gap-2">
                {onCancel ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={onCancel}
                    disabled={submitting}
                  >
                    Cancel
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="inverted"
                  disabled={!canSubmit}
                  loading={submitting}
                  onClick={onSubmit}
                  className="rounded-full px-3"
                >
                  Send
                </Button>
              </div>
            </div>
          </div>
        </div>

        {notices.length > 0 ? (
          <div className="mt-3 space-y-2">
            {notices.map((notice) => (
              <NoticeRow key={notice.id} notice={notice} />
            ))}
          </div>
        ) : null}

        {actions.length > 0 ? (
          <div className="mt-5 grid gap-2 sm:grid-cols-3">
            {actions.map((action) => (
              <Button
                key={action.id}
                type="button"
                variant="secondary"
                disabled={action.disabled}
                loading={action.loading}
                onClick={() => onAction?.(action.id)}
                className="h-auto justify-start rounded-lg px-3 py-2 text-left text-sm"
              >
                {action.icon ? <span className="shrink-0">{action.icon}</span> : null}
                <span className="truncate">{action.label}</span>
              </Button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PickerButton({
  pickerId,
  picker,
  onPickerSelect,
}: {
  pickerId: NewChatPickerId;
  picker: PickerView;
  onPickerSelect?: (picker: NewChatPickerId, itemId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selectedItem = useMemo(() => {
    for (const group of picker.groups) {
      const item = group.items.find((candidate) => candidate.selected);
      if (item) return item;
    }
    return picker.groups[0]?.items[0] ?? null;
  }, [picker.groups]);

  return (
    <div className="relative">
      <Button
        type="button"
        variant="secondary"
        disabled={picker.disabled}
        onClick={() => setOpen((value) => !value)}
        className="rounded-full px-3"
      >
        {picker.icon ? <span className="shrink-0">{picker.icon}</span> : null}
        <span>{selectedItem?.label ?? picker.label}</span>
      </Button>
      {open ? (
        <div className="absolute bottom-full left-0 z-20 mb-2 w-64 overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-popover">
          {picker.groups.map((group) => (
            <div key={group.id}>
              {group.label ? (
                <div className="px-2 pb-1 pt-2 text-[10.5px] font-semibold uppercase text-muted-foreground">
                  {group.label}
                </div>
              ) : null}
              {group.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  disabled={item.disabled}
                  onClick={() => {
                    onPickerSelect?.(pickerId, item.id);
                    setOpen(false);
                  }}
                  className="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-sm text-popover-foreground hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
                >
                  {item.icon ? <span className="mt-0.5 shrink-0">{item.icon}</span> : null}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{item.label}</span>
                    {item.description ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        {item.description}
                      </span>
                    ) : null}
                  </span>
                  {item.selected ? <span className="text-xs text-muted-foreground">Selected</span> : null}
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function NoticeRow({ notice }: { notice: NoticeView }) {
  const toneClass =
    notice.tone === "error"
      ? "border-destructive/30 bg-destructive-subtle text-destructive"
      : notice.tone === "warning"
        ? "border-warning/30 bg-warning-subtle text-warning"
        : "border-border bg-card text-muted-foreground";

  return (
    <div className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm ${toneClass}`}>
      <span className="min-w-0 flex-1">{notice.text}</span>
      {notice.action ? (
        <Button
          type="button"
          variant="secondary"
          disabled={notice.action.disabled}
          loading={notice.action.loading}
          onClick={notice.action.onClick}
        >
          {notice.action.label}
        </Button>
      ) : null}
    </div>
  );
}
