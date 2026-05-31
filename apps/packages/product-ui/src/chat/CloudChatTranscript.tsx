import {
  AlertTriangle,
  Bot,
  Brain,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Terminal,
  User,
  Wrench,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import type { CloudChatTranscriptRowView } from "@proliferate/product-domain/chats/cloud/transcript-view";
import { AssistantMessage } from "./transcript/AssistantMessage";
import { CopyMessageButton } from "./transcript/CopyMessageButton";
import { MarkdownBody as CloudChatMarkdownRenderer } from "./transcript/MarkdownBody";
import { ProposedPlanCard } from "./transcript/ProposedPlanCard";

const STREAM_FLUSH_MS = 32;
const MIN_STREAM_STEP = 20;
const MAX_STREAM_STEP = 120;

export type {
  CloudChatTranscriptRowKind,
  CloudChatTranscriptRowView,
} from "@proliferate/product-domain/chats/cloud/transcript-view";

export interface CloudChatTranscriptProps {
  rows: readonly CloudChatTranscriptRowView[];
  emptyTitle: string;
  emptyDescription?: string;
  planActions?: CloudChatTranscriptPlanActions;
}

export interface CloudChatTranscriptPlanActions {
  approvePlan?: (planId: string, expectedDecisionVersion: number) => void;
  rejectPlan?: (planId: string, expectedDecisionVersion: number) => void;
  isApprovingPlan?: boolean | ((planId: string, expectedDecisionVersion: number) => boolean);
  isRejectingPlan?: boolean | ((planId: string, expectedDecisionVersion: number) => boolean);
}

type CloudTranscriptActionStatus = "completed" | "failed" | "running";

export function CloudChatTranscript({
  rows,
  emptyTitle,
  emptyDescription,
  planActions,
}: CloudChatTranscriptProps) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card p-5 text-sm">
        <div className="font-medium text-foreground">{emptyTitle}</div>
        {emptyDescription ? (
          <p className="mt-1 text-muted-foreground">{emptyDescription}</p>
        ) : null}
      </div>
    );
  }

  return (
    <CloudChatTranscriptRows rows={rows} planActions={planActions} />
  );
}

export function CloudChatTranscriptRows({
  rows,
  planActions,
}: {
  rows: readonly CloudChatTranscriptRowView[];
  planActions?: CloudChatTranscriptPlanActions;
}) {
  return (
    <div className="space-y-4">
      {rows.map((row) => (
        <CloudChatTranscriptRow key={row.id} row={row} planActions={planActions} />
      ))}
    </div>
  );
}

export function CloudChatTranscriptRow({
  row,
  planActions,
}: {
  row: CloudChatTranscriptRowView;
  planActions?: CloudChatTranscriptPlanActions;
}) {
  if (row.kind === "user") {
    return (
      <CloudChatUserMessage
        content={row.body ?? ""}
        status={row.status}
      />
    );
  }

  if (row.kind === "assistant") {
    if (isAssistantLoadingRow(row)) {
      return <CloudChatAssistantLoadingRow row={row} />;
    }

    return (
      <article className="flex justify-start">
        <div className="flex min-w-0 max-w-full flex-col break-words" data-telemetry-mask>
          {row.title ? (
            <div className="mb-1 text-xs font-medium text-muted-foreground">{row.title}</div>
          ) : null}
          <AssistantMessage
            content={row.body ?? ""}
            isStreaming={row.streaming}
          />
        </div>
      </article>
    );
  }

  if (row.kind === "proposed_plan") {
    return <CloudChatProposedPlanRow row={row} planActions={planActions} />;
  }

  if (row.kind === "thought") {
    return <CloudChatThoughtRow row={row} />;
  }

  if (row.kind === "tool") {
    return <CloudChatToolRow row={row} />;
  }

  if (row.kind === "tool_group") {
    return <CloudChatToolGroupRow row={row} />;
  }

  if (row.kind === "system") {
    if ((row.title ?? "").toLowerCase() === "work history") {
      return <CloudChatWorkHistoryRow row={row} />;
    }
    return <CloudChatSystemRow row={row} />;
  }

  if (row.kind === "error") {
    return <CloudChatErrorRow row={row} />;
  }

  return <CloudChatToolRow row={row} />;
}

function CloudChatProposedPlanRow({
  row,
  planActions,
}: {
  row: CloudChatTranscriptRowView;
  planActions?: CloudChatTranscriptPlanActions;
}) {
  const planId = row.planId ?? null;
  const decisionVersion = row.planDecisionVersion ?? null;
  const canDecide = !!planId && decisionVersion !== null;
  return (
    <article className="flex justify-start">
      <div className="flex w-full max-w-full flex-col break-words" data-telemetry-mask>
        <ProposedPlanCard
          title={row.planTitle ?? row.title ?? "Plan"}
          content={row.planBodyMarkdown ?? row.body ?? ""}
          isStreaming={Boolean(row.streaming)}
          decisionState={row.planDecisionState ?? null}
          nativeResolutionState={row.planNativeResolutionState ?? null}
          decisionVersion={decisionVersion}
          errorMessage={row.planErrorMessage ?? null}
          nativeContinuation={Boolean(row.planNativeContinuation)}
          onApprove={
            canDecide && planActions?.approvePlan
              ? () => planActions.approvePlan!(planId, decisionVersion)
              : undefined
          }
          onReject={
            canDecide && planActions?.rejectPlan
              ? () => planActions.rejectPlan!(planId, decisionVersion)
              : undefined
          }
          isApproving={planDecisionActionActive(
            planActions?.isApprovingPlan,
            planId,
            decisionVersion,
          )}
          isRejecting={planDecisionActionActive(
            planActions?.isRejectingPlan,
            planId,
            decisionVersion,
          )}
        />
      </div>
    </article>
  );
}

function planDecisionActionActive(
  value: CloudChatTranscriptPlanActions["isApprovingPlan"],
  planId: string | null,
  expectedDecisionVersion: number | null,
): boolean {
  if (typeof value === "function") {
    return !!planId && expectedDecisionVersion !== null
      ? value(planId, expectedDecisionVersion)
      : false;
  }
  return Boolean(value);
}

function CloudChatAssistantLoadingRow({ row }: { row: CloudChatTranscriptRowView }) {
  return (
    <article
      aria-label="Assistant response loading"
      className="flex justify-start py-0.5"
      data-chat-transcript-ignore
    >
      <div
        className="max-w-full truncate text-chat italic leading-[var(--text-chat--line-height)] text-muted-foreground/80"
        data-telemetry-mask
      >
        {loadingStatusLabel(row)}
      </div>
    </article>
  );
}

function CloudChatThoughtRow({ row }: { row: CloudChatTranscriptRowView }) {
  const body = row.body?.trim() ?? "";
  const hint = row.detail ?? firstLine(body);

  return (
    <article className="flex justify-start">
      <CloudTranscriptActionRow
        icon={<Brain size={12} />}
        label={row.title ?? "Thinking"}
        hint={hint}
        status={resolveActionStatus(row)}
        defaultExpanded={false}
      >
        {body ? (
          <CloudTranscriptDetailsPanel>
            <pre
              className="max-h-72 whitespace-pre-wrap overflow-auto px-3 py-2.5 font-mono text-xs leading-5 text-muted-foreground"
              data-telemetry-mask
            >
              {body}
            </pre>
          </CloudTranscriptDetailsPanel>
        ) : null}
      </CloudTranscriptActionRow>
    </article>
  );
}

function CloudChatToolRow({ row }: { row: CloudChatTranscriptRowView }) {
  const Icon = iconForRow(row);
  const body = row.body?.trim() ?? "";
  const hint = row.detail ?? firstLine(body);
  const status = resolveActionStatus(row);

  return (
    <article className="flex justify-start">
      <CloudTranscriptActionRow
        icon={<Icon size={12} />}
        label={row.title ?? titleForRow(row)}
        hint={hint}
        status={status}
        statusLabel={row.status}
      >
        {body ? (
          <CloudTranscriptDetailsPanel>
            <div className="max-h-72 overflow-auto px-3 py-2.5" data-telemetry-mask>
              <CloudChatMarkdownRenderer
                content={body}
                className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0 text-muted-foreground"
              />
            </div>
          </CloudTranscriptDetailsPanel>
        ) : null}
      </CloudTranscriptActionRow>
    </article>
  );
}

function CloudChatToolGroupRow({ row }: { row: CloudChatTranscriptRowView }) {
  const [expanded, setExpanded] = useState(false);
  const body = row.body?.trim() ?? "";
  const children = row.children ?? [];
  const label = row.title ?? row.detail ?? "Work history";
  const hasExpandedContent = body.length > 0 || children.length > 0;

  return (
    <article className="py-1">
      <CloudTurnSeparator
        label={label}
        interactive={hasExpandedContent}
        expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      />
      {row.status ? (
        <div className="mt-0.5 text-center text-xs text-muted-foreground">
          {row.status}
        </div>
      ) : null}
      {expanded && hasExpandedContent ? (
        <div className="mt-2 space-y-1.5">
          {body ? (
            <CloudTranscriptDetailsPanel>
              <div className="max-h-72 overflow-auto px-3 py-2.5" data-telemetry-mask>
                <CloudChatMarkdownRenderer
                  content={body}
                  className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0 text-muted-foreground"
                />
              </div>
            </CloudTranscriptDetailsPanel>
          ) : null}
          {children.map((child) => (
            <CloudChatHistoryChildRow key={child.id} row={child} />
          ))}
        </div>
      ) : null}
    </article>
  );
}

function CloudChatWorkHistoryRow({ row }: { row: CloudChatTranscriptRowView }) {
  const [expanded, setExpanded] = useState(false);
  const children = row.children ?? [];
  const summary = row.detail ?? row.body ?? row.title ?? "Work history";
  const hasExpandedContent = children.length > 0 || Boolean(row.body?.trim());

  return (
    <article className="py-1">
      <CloudTurnSeparator
        label={summary}
        interactive={hasExpandedContent}
        expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      />
      {expanded && hasExpandedContent ? (
        <div className="mt-2 space-y-1.5">
          {row.body?.trim() ? (
            <CloudTranscriptDetailsPanel>
              <div className="max-h-72 overflow-auto px-3 py-2.5" data-telemetry-mask>
                <CloudChatMarkdownRenderer
                  content={row.body}
                  className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0 text-muted-foreground"
                />
              </div>
            </CloudTranscriptDetailsPanel>
          ) : null}
          {children.map((child) => (
            <CloudChatHistoryChildRow key={child.id} row={child} />
          ))}
          <CloudTurnSeparator label="Final message" />
        </div>
      ) : null}
    </article>
  );
}

function CloudChatHistoryChildRow({ row }: { row: CloudChatTranscriptRowView }) {
  if (row.kind === "tool_group") {
    const status = resolveActionStatus(row);
    const statusLabel = row.status && row.status !== "completed" ? row.status : null;
    return (
      <article className="flex justify-start">
        <CloudTranscriptActionRow
          icon={<Wrench size={12} />}
          label={row.title ?? "Tool activity"}
          hint={row.detail}
          status={status}
          statusLabel={statusLabel}
        />
      </article>
    );
  }

  return <CloudChatTranscriptRow row={row} />;
}

function isAssistantLoadingRow(row: CloudChatTranscriptRowView): boolean {
  return row.kind === "assistant"
    && Boolean(row.streaming)
    && (
      !row.body?.trim()
      || row.id.includes(":assistant-waiting")
      || row.id.includes(":pending-assistant")
    );
}

function loadingStatusText(row: CloudChatTranscriptRowView): string | null {
  const value = row.detail ?? row.body ?? row.status ?? null;
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function loadingStatusLabel(row: CloudChatTranscriptRowView): string {
  const status = loadingStatusText(row) ?? "Loading";
  return `${status.replace(/[\s.]+$/g, "")}...`;
}

function CloudChatSystemRow({ row }: { row: CloudChatTranscriptRowView }) {
  const [expanded, setExpanded] = useState(false);
  const body = row.body ?? row.detail ?? "";
  const children = row.children ?? [];
  const hasExpandedContent = body.length > 0 || children.length > 0;

  return (
    <article className="py-1.5">
      <Button
        type="button"
        variant="ghost"
        data-chat-transcript-ignore
        disabled={!hasExpandedContent}
        onClick={() => {
          if (hasExpandedContent) {
            setExpanded((value) => !value);
          }
        }}
        className="flex h-auto w-full justify-start gap-2 rounded-none bg-transparent px-3 py-1.5 text-left font-sans text-xs text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground"
        aria-expanded={expanded}
      >
        <ChevronRight
          aria-hidden="true"
          className={`size-3 shrink-0 transition-transform duration-150 ${
            expanded ? "rotate-90" : ""
          }`}
        />
        <span>{row.title ?? "System message"}</span>
      </Button>
      {expanded && hasExpandedContent ? (
        <div className="mt-1 space-y-1.5">
          {body ? (
            <div
              className="whitespace-pre-wrap rounded-md border border-border bg-card px-3.5 py-2.5 font-sans text-[12px] leading-[1.65] text-muted-foreground select-text"
              data-telemetry-mask
            >
              {body}
            </div>
          ) : null}
          {children.length > 0 ? (
            <div className="space-y-1.5">
              {children.map((child) => (
                <CloudChatTranscriptRow key={child.id} row={child} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function CloudChatErrorRow({ row }: { row: CloudChatTranscriptRowView }) {
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const body = row.body?.trim() ?? "";
  const description = row.detail ?? firstLine(body);
  const hasDetails = body.length > 0 && body !== description;

  return (
    <article className="rounded-lg border border-destructive/20 bg-destructive/[0.04] px-3 py-2 text-sm">
      <div className="flex min-w-0 items-start gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive/80" />
        <div className="min-w-0 flex-1">
          <div className="font-[520] text-destructive">{row.title ?? "Error"}</div>
          {description ? (
            <div className="mt-0.5 text-muted-foreground" data-telemetry-mask>
              {description}
            </div>
          ) : null}
        </div>
      </div>
      {row.status || hasDetails ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 pl-6">
          {row.status ? (
            <span className="text-xs text-muted-foreground">{row.status}</span>
          ) : null}
          {hasDetails ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-chat-transcript-ignore
              onClick={() => setDetailsExpanded((value) => !value)}
              className="gap-1 px-1.5 text-xs text-muted-foreground hover:text-foreground"
              aria-expanded={detailsExpanded}
            >
              <ChevronRight
                aria-hidden="true"
                className={`size-3 transition-transform ${detailsExpanded ? "rotate-90" : ""}`}
              />
              Details
            </Button>
          ) : null}
        </div>
      ) : null}
      {detailsExpanded && hasDetails ? (
        <div
          className="mt-2 whitespace-pre-wrap rounded-md border border-border/70 bg-background/70 px-2.5 py-2 font-mono text-xs leading-5 text-muted-foreground select-text"
          data-telemetry-mask
        >
          {body}
        </div>
      ) : null}
    </article>
  );
}

function CloudTranscriptActionRow({
  icon,
  label,
  hint,
  status,
  statusLabel,
  children,
  defaultExpanded = false,
}: {
  icon?: ReactNode;
  label: ReactNode;
  hint?: ReactNode;
  status: CloudTranscriptActionStatus;
  statusLabel?: string | null;
  children?: ReactNode;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const hasDetails = Boolean(children);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (
      event.target === event.currentTarget
      && (event.key === "Enter" || event.key === " ")
    ) {
      event.preventDefault();
      setExpanded((value) => !value);
    }
  }

  return (
    <div className="max-w-full py-0.5">
      {hasDetails ? (
        <div
          role="button"
          tabIndex={0}
          data-chat-transcript-ignore
          aria-expanded={expanded}
          className={`group/tool-action-row inline-flex min-w-0 max-w-full cursor-pointer items-center gap-1 rounded-none bg-transparent p-0 text-left text-chat font-normal leading-[var(--text-chat--line-height)] outline-none focus-visible:underline ${
            status === "failed"
              ? "text-destructive/80 hover:text-destructive"
              : "text-muted-foreground/80 hover:text-foreground"
          }`}
          onClick={() => setExpanded((value) => !value)}
          onKeyDown={handleKeyDown}
        >
          <CloudTranscriptActionRowContent
            icon={icon}
            label={label}
            hint={hint}
            statusLabel={statusLabel}
            expandable
            expanded={expanded}
          />
        </div>
      ) : (
        <div
          className={`inline-flex min-w-0 max-w-full items-center gap-1 text-chat leading-[var(--text-chat--line-height)] ${
            status === "failed" ? "text-destructive/80" : "text-muted-foreground/80"
          }`}
        >
          <CloudTranscriptActionRowContent
            icon={icon}
            label={label}
            hint={hint}
            statusLabel={statusLabel}
            expandable={false}
            expanded={false}
          />
        </div>
      )}
      {expanded && children ? <div className="mt-1.5">{children}</div> : null}
    </div>
  );
}

function CloudTranscriptActionRowContent({
  icon,
  label,
  hint,
  statusLabel,
  expandable,
  expanded,
}: {
  icon?: ReactNode;
  label: ReactNode;
  hint?: ReactNode;
  statusLabel?: string | null;
  expandable: boolean;
  expanded: boolean;
}) {
  return (
    <>
      <CloudTranscriptActionLeadingAffordance
        icon={icon}
        expandable={expandable}
        expanded={expanded}
      />
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <div className="min-w-0 shrink-0 text-inherit">{label}</div>
        {renderInlineHint(hint)}
        {statusLabel ? (
          <span className="shrink-0 text-xs text-muted-foreground/80">
            {statusLabel}
          </span>
        ) : null}
      </div>
    </>
  );
}

function CloudTranscriptActionLeadingAffordance({
  icon,
  expandable,
  expanded,
}: {
  icon?: ReactNode;
  expandable: boolean;
  expanded: boolean;
}) {
  return (
    <span className="relative flex h-3 w-3 shrink-0 items-center justify-center">
      <span
        className={`absolute inset-0 flex items-center justify-center transition-all duration-150 ${
          expandable
            ? expanded
              ? "scale-75 opacity-0"
              : "scale-100 opacity-100 group-hover/tool-action-row:scale-75 group-hover/tool-action-row:opacity-0 group-focus-visible/tool-action-row:scale-75 group-focus-visible/tool-action-row:opacity-0"
            : "scale-100 opacity-100"
        }`}
      >
        <span className="flex h-3 w-3 items-center justify-center text-xs leading-none transition-colors [&_svg]:size-2.5 [&_svg]:text-muted-foreground group-hover/tool-action-row:[&_svg]:text-foreground/70">
          {icon}
        </span>
      </span>
      <span
        className={`absolute inset-0 flex items-center justify-center transition-all duration-150 ${
          expandable
            ? expanded
              ? "scale-100 opacity-100"
              : "scale-75 opacity-0 group-hover/tool-action-row:scale-100 group-hover/tool-action-row:opacity-100 group-focus-visible/tool-action-row:scale-100 group-focus-visible/tool-action-row:opacity-100"
            : "scale-75 opacity-0"
        }`}
      >
        <ChevronRight
          aria-hidden="true"
          className={`size-2.5 shrink-0 text-muted-foreground/70 transition-transform ${
            expanded ? "rotate-90" : ""
          }`}
        />
      </span>
    </span>
  );
}

function CloudTranscriptDetailsPanel({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-border/60 bg-foreground/[0.04]">
      {children}
    </div>
  );
}

function CloudTurnSeparator({
  label,
  interactive = false,
  expanded = false,
  onClick,
}: {
  label: string;
  interactive?: boolean;
  expanded?: boolean;
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className="flex-1 border-t border-current/20" />
      <span className="flex min-w-0 items-center gap-1 whitespace-nowrap">
        <span className="truncate text-foreground/60">{label}</span>
        {interactive ? (
          <ChevronRight
            aria-hidden="true"
            className={`size-3 text-foreground/40 transition-transform duration-200 ${
              expanded ? "rotate-90" : ""
            }`}
          />
        ) : null}
      </span>
      <div className="flex-1 border-t border-current/20" />
    </>
  );

  if (interactive) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        data-chat-transcript-ignore
        onClick={onClick}
        className="h-auto w-full gap-2 whitespace-normal rounded-md border border-transparent bg-transparent px-0 py-1 text-[length:var(--text-chat)] leading-[var(--text-chat--line-height)] text-muted-foreground hover:bg-transparent hover:text-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={expanded}
      >
        {content}
      </Button>
    );
  }

  return (
    <div className="my-2 flex items-center gap-2 text-chat leading-[var(--text-chat--line-height)] text-muted-foreground">
      {content}
    </div>
  );
}

function renderInlineHint(hint?: ReactNode) {
  if (hint === undefined || hint === null || hint === false) {
    return null;
  }

  if (typeof hint === "string" || typeof hint === "number") {
    const value = String(hint).trim();
    if (!value) {
      return null;
    }
    return (
      <span
        title={value}
        className="max-w-[260px] min-w-0 shrink truncate rounded-sm border border-border/60 bg-muted/45 px-1.5 py-0.5 font-mono text-[0.6rem] leading-none text-muted-foreground"
        data-telemetry-mask
      >
        {value}
      </span>
    );
  }

  return <div className="min-w-0 shrink">{hint}</div>;
}

function CloudChatUserMessage({
  content,
  status = null,
}: {
  content: string;
  status?: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [needsToggle, setNeedsToggle] = useState(false);
  const textRef = useRef<HTMLDivElement>(null);
  const hasContent = content.trim().length > 0;
  const visibleStatus = userMessageStatusLabel(status);

  useLayoutEffect(() => {
    if (!hasContent) {
      setNeedsToggle(false);
      return;
    }
    const el = textRef.current;
    if (!el) return;
    setNeedsToggle(el.scrollHeight > el.clientHeight);
  }, [content, hasContent]);

  return (
    <article className="group/msg flex justify-end" data-chat-user-message>
      <div className="flex w-full flex-col items-end justify-end gap-1">
        {hasContent ? (
          <div
            className="max-w-[77%] break-words rounded-2xl bg-foreground/5 px-3 py-2 text-foreground"
            data-telemetry-mask
          >
            <div
              ref={textRef}
              className={`break-words select-text text-chat leading-[var(--text-chat--line-height)]${
                !expanded ? " line-clamp-5" : ""
              }`}
            >
              {content}
            </div>
            {needsToggle ? (
              <div className="mt-1 flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  data-chat-transcript-ignore
                  onClick={() => setExpanded((value) => !value)}
                  className="h-auto px-1 py-0 text-[11px] text-muted-foreground hover:bg-transparent hover:text-foreground"
                >
                  {expanded ? "Show less" : "Show more"}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
        {visibleStatus ? (
          <div className="inline-flex items-center gap-1 pr-1 text-xs text-muted-foreground">
            {visibleStatus}
          </div>
        ) : null}
        {hasContent ? (
          <div className="pr-1 pt-0.5">
            <CopyMessageButton
              content={content}
              timestampLabel={null}
              visibilityClassName="opacity-0 group-hover/msg:opacity-100"
            />
          </div>
        ) : null}
      </div>
    </article>
  );
}

function userMessageStatusLabel(status: string | null | undefined): string | null {
  const value = status?.trim();
  if (!value) {
    return null;
  }
  return /\b(failed|error|rejected|expired|could not|timed out)\b/i.test(value)
    ? value
    : null;
}

export interface CloudChatAssistantMessageProps {
  content: string;
  isStreaming?: boolean;
}

export function CloudChatAssistantMessage({
  content,
  isStreaming = false,
}: CloudChatAssistantMessageProps) {
  return (
    <div className="select-text text-chat leading-[var(--text-chat--line-height)] text-foreground">
      <CloudChatAssistantMessageContent content={content} isStreaming={isStreaming} />
    </div>
  );
}

function CloudChatAssistantMessageContent({
  content,
  isStreaming = false,
}: {
  content: string;
  isStreaming?: boolean;
}) {
  const [visibleContent, setVisibleContent] = useState(content);
  const visibleContentRef = useRef(content);
  const targetContentRef = useRef(content);
  const flushFrameRef = useRef<number | null>(null);
  const lastFlushAtRef = useRef(0);
  const liveRef = useRef<HTMLDivElement>(null);
  const prevSplitRef = useRef({ stable: "", live: "" });

  const scheduleFlush = () => {
    if (flushFrameRef.current !== null) {
      return;
    }
    flushFrameRef.current = window.requestAnimationFrame((timestamp) => {
      flushFrameRef.current = null;
      if (timestamp - lastFlushAtRef.current < STREAM_FLUSH_MS) {
        scheduleFlush();
        return;
      }

      lastFlushAtRef.current = timestamp;
      const nextVisible = selectVisibleTarget(
        targetContentRef.current,
        visibleContentRef.current.length,
      );
      if (nextVisible.length !== visibleContentRef.current.length) {
        visibleContentRef.current = nextVisible;
        setVisibleContent(nextVisible);
      }
      if (visibleContentRef.current.length < targetContentRef.current.length) {
        scheduleFlush();
      }
    });
  };

  useEffect(() => {
    targetContentRef.current = content;

    if (content.length < visibleContentRef.current.length) {
      if (flushFrameRef.current !== null) {
        window.cancelAnimationFrame(flushFrameRef.current);
        flushFrameRef.current = null;
      }
      lastFlushAtRef.current = 0;
      visibleContentRef.current = content;
      setVisibleContent(content);
      return;
    }

    if (content.length === visibleContentRef.current.length) {
      return;
    }

    scheduleFlush();
    return () => {
      if (flushFrameRef.current !== null) {
        window.cancelAnimationFrame(flushFrameRef.current);
        flushFrameRef.current = null;
      }
    };
  }, [content, isStreaming]);

  const splitContent = useMemo(
    () => splitAssistantContent(visibleContent),
    [visibleContent],
  );
  const isRevealing = visibleContent.length < content.length;
  const stableClassName = splitContent.liveContent
    ? "[&>*:first-child]:mt-0"
    : "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0";
  const liveClassName = splitContent.stableContent
    ? "[&>*:last-child]:mb-0"
    : "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0";

  useLayoutEffect(() => {
    const el = liveRef.current;
    const prev = prevSplitRef.current;
    const nextStable = splitContent.stableContent;
    const nextLive = splitContent.liveContent;
    const active = splitContent.animateLiveContent && (isStreaming || isRevealing);
    const isFirstLive = prev.live.length === 0 && nextLive.length > 0;
    const isBoundaryCrossed = nextStable.length > prev.stable.length;

    prevSplitRef.current = { stable: nextStable, live: nextLive };

    if (!el) return;
    if (!active) {
      el.classList.remove("animate-streaming-fade");
      return;
    }
    if (isFirstLive || isBoundaryCrossed) {
      el.classList.remove("animate-streaming-fade");
      void el.offsetHeight;
      el.classList.add("animate-streaming-fade");
    }
  }, [
    splitContent.stableContent,
    splitContent.liveContent,
    splitContent.animateLiveContent,
    isStreaming,
    isRevealing,
  ]);

  return (
    <>
      {splitContent.stableContent ? (
        <CloudChatMarkdownRenderer
          content={splitContent.stableContent}
          className={stableClassName}
        />
      ) : null}
      {splitContent.liveContent ? (
        <div ref={liveRef}>
          <CloudChatMarkdownRenderer
            content={splitContent.liveContent}
            className={liveClassName}
          />
        </div>
      ) : null}
    </>
  );
}

function splitAssistantContent(content: string): {
  stableContent: string;
  liveContent: string;
  animateLiveContent: boolean;
} {
  if (!content) {
    return { stableContent: "", liveContent: "", animateLiveContent: false };
  }

  const structuredTail = hasOpenCodeFence(content) || hasTrailingTable(content);
  if (!needsStableStreamingSplit(content)) {
    return {
      stableContent: "",
      liveContent: content,
      animateLiveContent: true,
    };
  }

  const boundary = content.lastIndexOf("\n\n");
  if (boundary < 0 || boundary + 2 >= content.length) {
    return {
      stableContent: "",
      liveContent: content,
      animateLiveContent: !structuredTail,
    };
  }

  return {
    stableContent: content.slice(0, boundary + 2),
    liveContent: content.slice(boundary + 2),
    animateLiveContent: !structuredTail,
  };
}

function selectVisibleTarget(content: string, currentLength: number): string {
  if (content.length <= currentLength) {
    return content;
  }

  const nextLength = Math.min(
    content.length,
    currentLength + resolveRevealStep(content.length - currentLength),
  );

  if (!hasOpenCodeFence(content) && !hasTrailingTable(content)) {
    return content.slice(0, findTextBoundary(content, currentLength, nextLength));
  }

  const nextNewlineIndex = content.indexOf("\n", nextLength);
  if (nextNewlineIndex !== -1 && nextNewlineIndex < currentLength + MAX_STREAM_STEP * 2) {
    return content.slice(0, nextNewlineIndex + 1);
  }

  const priorNewlineIndex = content.lastIndexOf("\n", nextLength);
  if (priorNewlineIndex > currentLength) {
    return content.slice(0, priorNewlineIndex + 1);
  }

  return content.slice(0, nextLength);
}

function resolveRevealStep(remainingLength: number): number {
  return Math.max(
    MIN_STREAM_STEP,
    Math.min(MAX_STREAM_STEP, Math.ceil(remainingLength / 4)),
  );
}

function findTextBoundary(
  content: string,
  currentLength: number,
  targetLength: number,
): number {
  if (targetLength >= content.length) {
    return content.length;
  }

  const paragraphBoundary = content.lastIndexOf("\n\n", targetLength);
  if (paragraphBoundary >= currentLength + MIN_STREAM_STEP) {
    return paragraphBoundary + 2;
  }

  const lineBoundary = content.lastIndexOf("\n", targetLength);
  if (lineBoundary >= currentLength + Math.floor(MIN_STREAM_STEP / 2)) {
    return lineBoundary + 1;
  }

  const whitespaceBoundary = content.lastIndexOf(" ", targetLength);
  if (whitespaceBoundary >= currentLength + Math.floor(MIN_STREAM_STEP / 2)) {
    return whitespaceBoundary + 1;
  }

  return targetLength;
}

function needsStableStreamingSplit(content: string): boolean {
  return content.includes("```") || hasTrailingTable(content);
}

function hasOpenCodeFence(content: string): boolean {
  return (content.match(/```/g)?.length ?? 0) % 2 === 1;
}

function hasTrailingTable(content: string): boolean {
  const lines = content.trimEnd().split("\n");
  if (lines.length < 2) return false;
  const tail = lines.slice(-3);
  const tableLikeLines = tail.filter((line) => {
    const trimmed = line.trim();
    return trimmed.startsWith("|") && trimmed.endsWith("|");
  });
  return tableLikeLines.length >= 2;
}

function iconForRow(row: CloudChatTranscriptRowView) {
  switch (row.kind) {
    case "error":
      return AlertTriangle;
    case "system":
      return Bot;
    case "thought":
      return Brain;
    case "tool":
      return row.status === "completed" ? CheckCircle2 : Terminal;
    case "tool_group":
      return Wrench;
    case "user":
      return User;
    case "assistant":
    default:
      return row.streaming ? Clock3 : Bot;
  }
}

function resolveActionStatus(row: CloudChatTranscriptRowView): CloudTranscriptActionStatus {
  const status = row.status?.toLowerCase() ?? "";
  if (
    row.kind === "error"
    || status.includes("fail")
    || status.includes("error")
    || status.includes("reject")
    || status.includes("expired")
  ) {
    return "failed";
  }
  if (
    row.streaming
    || status.includes("running")
    || status.includes("pending")
    || status.includes("queued")
    || status.includes("sending")
    || status.includes("progress")
    || status.includes("approval")
  ) {
    return "running";
  }
  return "completed";
}

function firstLine(value: string): string | null {
  const line = value.trim().split(/\r?\n/, 1)[0]?.trim();
  return line || null;
}

function titleForRow(row: CloudChatTranscriptRowView): string {
  switch (row.kind) {
    case "error":
      return "Error";
    case "system":
      return "System";
    case "thought":
      return "Reasoning";
    case "tool_group":
      return "Actions";
    case "tool":
      return "Tool call";
    case "user":
      return "User";
    case "assistant":
    default:
      return "Assistant";
  }
}
