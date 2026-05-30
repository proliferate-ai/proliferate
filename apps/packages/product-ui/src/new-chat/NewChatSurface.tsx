import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

import type { RecentWorkItemView } from "@proliferate/product-domain/workspaces/cloud-work-inventory";
import { Button } from "@proliferate/ui/primitives/Button";
import {
  CloudChatComposer,
  type CloudChatComposerControlView,
} from "../chat/CloudChatComposer";
import {
  CloudChatTranscript,
  type CloudChatTranscriptRowView,
} from "../chat/CloudChatTranscript";
import { RecentWorkStatusDot } from "../workspaces/RecentWorkStatusDot";

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
  extraComposerControls?: readonly CloudChatComposerControlView[];
  transcriptRows?: readonly CloudChatTranscriptRowView[];
  recentItems?: readonly RecentWorkItemView[];
  recentLoading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  commandMessage?: string | null;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
  onCancel?: () => void;
  onPickerSelect?: (picker: NewChatPickerId, itemId: string) => void;
  onAction?: (id: string) => void;
  onRecentSelect?: (item: RecentWorkItemView) => void;
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
  extraComposerControls,
  transcriptRows = [],
  recentItems = [],
  recentLoading = false,
  emptyTitle = "No transcript",
  emptyDescription,
  commandMessage = null,
  onDraftChange,
  onSubmit,
  onCancel,
  onPickerSelect,
  onAction,
  onRecentSelect,
}: NewChatSurfaceProps) {
  const composerControls = [
    pickerToComposerControl("target", target, "sparkles", "leading", onPickerSelect),
    ...(extraComposerControls ?? [
      pickerToComposerControl("model", model, "bot", "trailing", onPickerSelect),
      pickerToComposerControl("mode", mode, "settings", "trailing", onPickerSelect),
    ]),
  ];
  const footerComposerKeys = new Set(["target", "branch", "runtime"]);
  const mainComposerControls = composerControls.filter((control) =>
    !footerComposerKeys.has(control.key ?? "")
  );
  const footerComposerControls = composerControls.filter((control) =>
    footerComposerKeys.has(control.key ?? "")
  );

  return (
    <div className="relative flex h-full w-full min-w-0 flex-1 overflow-hidden bg-background text-foreground">
      <main className="web-scrollbar flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 py-16">
        <div className="w-full max-w-3xl">
          <header className="mb-5 flex flex-col items-center text-center">
            <h1 className="max-w-[34rem] text-2xl font-medium leading-tight text-foreground">
              {heading}
            </h1>
          </header>

          <CloudChatComposer
            composer={{
              value: draft,
              placeholder,
              canSubmit,
              isSubmitting: submitting,
              controls: mainComposerControls,
              footerComposerControls,
              disabled: submitting,
              onChange: onDraftChange,
              onSubmit,
            }}
          />

          {onCancel ? (
            <div className="mx-auto mt-2 flex max-w-3xl justify-end px-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onCancel}
                disabled={submitting}
              >
                Cancel
              </Button>
            </div>
          ) : null}

          {commandMessage ? (
            <p className="mx-auto mt-2 max-w-3xl px-2 text-center text-xs text-muted-foreground">
              {commandMessage}
            </p>
          ) : null}

          {notices.length > 0 ? (
            <div className="mx-auto mt-3 max-w-2xl space-y-2">
              {notices.map((notice) => (
                <NoticeRow key={notice.id} notice={notice} />
              ))}
            </div>
          ) : null}

          {transcriptRows.length > 0 ? (
            <div className="mx-auto mt-5 max-w-3xl" data-home-submit-preview>
              <CloudChatTranscript
                rows={transcriptRows}
                emptyTitle={emptyTitle}
                emptyDescription={emptyDescription}
              />
            </div>
          ) : null}

          {actions.length > 0 ? (
            <div className="mx-auto mt-3 max-w-2xl">
              <div className="flex flex-col gap-px">
                {actions.map((action) => (
                  <Button
                    key={action.id}
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={action.disabled}
                    loading={action.loading}
                    onClick={() => onAction?.(action.id)}
                    className="h-auto w-full justify-start gap-2 rounded-lg px-3 py-2 text-left text-sm font-normal text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                  >
                    {action.icon ? <span className="shrink-0">{action.icon}</span> : null}
                    <span className="min-w-0 flex-1 truncate">{action.label}</span>
                  </Button>
                ))}
              </div>
            </div>
          ) : null}

          {recentItems.length > 0 || recentLoading ? (
            <RecentWorkList
              items={recentItems}
              loading={recentLoading}
              onSelect={onRecentSelect}
            />
          ) : null}
        </div>
      </main>
    </div>
  );
}

function pickerToComposerControl(
  pickerId: NewChatPickerId,
  picker: PickerView,
  icon: CloudChatComposerControlView["icon"],
  placement: CloudChatComposerControlView["placement"],
  onPickerSelect?: (picker: NewChatPickerId, itemId: string) => void,
): CloudChatComposerControlView {
  return {
    id: `new-chat-${pickerId}`,
    key: pickerId,
    label: picker.label,
    icon,
    placement,
    disabled: picker.disabled,
    groups: picker.groups.map((group) => ({
      id: group.id,
      label: group.label ?? null,
      options: group.items.map((item) => ({
        id: item.id,
        label: item.label,
        description: item.description ?? null,
        disabled: item.disabled,
        selected: item.selected,
      })),
    })),
    onSelect: (itemId) => onPickerSelect?.(pickerId, itemId),
  };
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

function RecentWorkList({
  items,
  loading,
  onSelect,
}: {
  items: readonly RecentWorkItemView[];
  loading: boolean;
  onSelect?: (item: RecentWorkItemView) => void;
}) {
  return (
    <section className="mx-auto mt-8 max-w-3xl">
      <header className="mb-2 flex items-center px-1">
        <h2 className="text-sm font-medium leading-5 text-muted-foreground">
          Recent work
        </h2>
      </header>
      <div className="flex flex-col gap-1">
        {items.map((item) => (
          <RecentWorkRow
            key={item.id}
            item={item}
            onSelect={onSelect}
          />
        ))}
        {loading && items.length === 0 ? (
          <>
            <RecentWorkSkeleton />
            <RecentWorkSkeleton />
            <RecentWorkSkeleton />
          </>
        ) : null}
      </div>
    </section>
  );
}

function RecentWorkRow({
  item,
  onSelect,
}: {
  item: RecentWorkItemView;
  onSelect?: (item: RecentWorkItemView) => void;
}) {
  const preview = recentWorkPreview(item);

  return (
    <Button
      type="button"
      variant="unstyled"
      size="unstyled"
      onClick={() => onSelect?.(item)}
      className="group flex h-10 w-full min-w-0 items-center justify-between gap-3 rounded-lg bg-foreground/5 px-3 text-left text-sm leading-5 text-foreground whitespace-normal hover:bg-foreground/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
    >
      <span className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex w-[6.75rem] shrink-0 items-center">
          <RecentWorkStatusDot indicator={item.statusIndicator} showLabel />
        </span>
        <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span className="min-w-0 truncate text-foreground">
            {item.title}
          </span>
          {preview ? (
            <span className="min-w-0 flex-[2] truncate text-muted-foreground">
              {preview}
            </span>
          ) : null}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
        {item.repoLabel ? (
          <span className="hidden max-w-[11rem] truncate text-xs sm:block">
            {item.repoLabel}
          </span>
        ) : null}
        <span className="min-w-6 text-right text-xs tabular-nums">
          {item.lastActivityLabel}
        </span>
        <ChevronRight className="size-3.5 transition-colors group-hover:text-foreground" />
      </span>
    </Button>
  );
}

function RecentWorkSkeleton() {
  return (
    <div className="h-10 rounded-lg bg-foreground/5 px-3">
      <div className="flex h-full items-center gap-3">
        <div className="h-2 w-24 rounded-full bg-foreground/10" />
        <div className="h-2 flex-1 rounded-full bg-foreground/10" />
        <div className="h-2 w-10 rounded-full bg-foreground/10" />
      </div>
    </div>
  );
}

function recentWorkPreview(item: RecentWorkItemView): string | null {
  const preview = item.activityPreview?.trim();
  if (preview) {
    return preview;
  }
  const subtitle = item.subtitle?.trim();
  return subtitle && subtitle !== item.title ? subtitle : null;
}
