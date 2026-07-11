import { Fragment, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Brain,
  ChevronRight,
} from "lucide-react";
import { Button } from "@proliferate/ui/primitives/Button";
import { ThinkingText } from "@proliferate/ui/primitives/ThinkingText";
import type { CloudChatTranscriptRowView } from "./CloudChatTranscriptTypes";
import { MarkdownBody as CloudChatMarkdownRenderer } from "./MarkdownBody";
import {
  CloudTranscriptActionRow,
  CloudTranscriptDetailsPanel,
  CloudTurnSeparator,
} from "./CloudTranscriptActionRow";
import {
  firstLine,
  iconForRow,
  isActionActivelyRunning,
  loadingStatusLabel,
  resolveActionStatus,
  titleForRow,
} from "./CloudChatTranscriptPresentation";

export function CloudChatAssistantLoadingRow({ row }: { row: CloudChatTranscriptRowView }) {
  // The live "Thinking…" voice: same band-sweep treatment as the desktop
  // transcript (shared ThinkingText). Opacity/transform-only — the band is
  // absolutely positioned over the label, so the row's geometry is byte-for-
  // byte the static text it replaces.
  return (
    <article
      aria-label="Assistant response loading"
      className="flex justify-start py-0.5"
      data-chat-transcript-ignore
    >
      <ThinkingText
        text={loadingStatusLabel(row)}
        className="block max-w-full truncate font-normal"
        data-telemetry-mask
      />
    </article>
  );
}

export function CloudChatThoughtRow({ row }: { row: CloudChatTranscriptRowView }) {
  const body = row.body?.trim() ?? "";
  const hint = row.detail ?? firstLine(body);
  const status = resolveActionStatus(row);
  const labelText = row.title ?? "Thinking";

  return (
    <article className="flex justify-start">
      <CloudTranscriptActionRow
        icon={<Brain size={12} />}
        label={
          status === "running" ? (
            // Live reasoning: the label carries the shared thinking sweep
            // (desktop CollapsedActions parity); completed rows go static.
            <ThinkingText
              text={labelText}
              className="block max-w-full truncate font-normal leading-[inherit]"
            />
          ) : (
            labelText
          )
        }
        hint={hint}
        status={status}
        defaultExpanded={false}
      >
        {body ? (
          <CloudTranscriptDetailsPanel>
            <pre
              className="max-h-72 overflow-auto whitespace-pre-wrap px-3 py-2.5 font-mono text-xs leading-5 text-muted-foreground"
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

export function CloudChatToolRow({ row }: { row: CloudChatTranscriptRowView }) {
  const Icon = iconForRow(row);
  const body = row.body?.trim() ?? "";
  const hint = row.detail ?? firstLine(body);
  const status = resolveActionStatus(row);

  return (
    <article className="flex justify-start">
      <CloudTranscriptActionRow
        icon={<Icon className="size-4" />}
        label={isActionActivelyRunning(row)
          ? (
            <ThinkingText
              text={row.title ?? titleForRow(row)}
              className="block max-w-full truncate font-normal leading-[inherit]"
            />
          )
          : row.title ?? titleForRow(row)}
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

export function CloudChatToolGroupRow({
  row,
  renderChildRow,
}: {
  row: CloudChatTranscriptRowView;
  renderChildRow: (row: CloudChatTranscriptRowView) => ReactNode;
}) {
  const body = row.body?.trim() ?? "";
  const children = row.children ?? [];
  const label = row.title ?? row.detail ?? "Work history";
  const hasExpandedContent = body.length > 0 || children.length > 0;
  const status = resolveActionStatus(row);
  const Icon = iconForRow(row);
  const statusLabel = nonLiveActionStatusLabel(row.status);

  return (
    <article className="flex justify-start py-0.5">
      <CloudTranscriptActionRow
        icon={<Icon className="size-4" />}
        label={isActionActivelyRunning(row)
          ? <ThinkingText text={label} className="block max-w-full truncate font-normal" />
          : label}
        hint={row.detail}
        status={status}
        statusLabel={statusLabel}
      >
        {hasExpandedContent ? <div className="space-y-1.5">
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
            <CloudChatHistoryChildRow
              key={child.id}
              row={child}
              renderChildRow={renderChildRow}
            />
          ))}
        </div> : null}
      </CloudTranscriptActionRow>
    </article>
  );
}

export function CloudChatWorkHistoryRow({
  row,
  renderChildRow,
}: {
  row: CloudChatTranscriptRowView;
  renderChildRow: (row: CloudChatTranscriptRowView) => ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const children = row.children ?? [];
  const label = row.title ?? "Worked";
  const hasExpandedContent = children.length > 0 || Boolean(row.body?.trim());

  return (
    <article className="py-1" data-cloud-work-history>
      <CloudTurnSeparator
        label={label}
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
            <CloudChatHistoryChildRow
              key={child.id}
              row={child}
              renderChildRow={renderChildRow}
            />
          ))}
        </div>
      ) : null}
      <div
        aria-hidden="true"
        data-chat-transcript-ignore
        className="mt-1 w-full border-t border-border"
      />
    </article>
  );
}

function CloudChatHistoryChildRow({
  row,
  renderChildRow,
}: {
  row: CloudChatTranscriptRowView;
  renderChildRow: (row: CloudChatTranscriptRowView) => ReactNode;
}) {
  if (row.kind === "tool_group") {
    return (
      <CloudChatToolGroupRow
        row={row}
        renderChildRow={renderChildRow}
      />
    );
  }

  return <>{renderChildRow(row)}</>;
}

function nonLiveActionStatusLabel(status: string | null | undefined): string | null {
  const value = status?.trim();
  if (!value) {
    return null;
  }
  switch (value.toLowerCase()) {
    case "completed":
    case "running":
    case "in progress":
    case "in_progress":
    case "streaming":
    case "sending":
      return null;
    default:
      return value;
  }
}

export function CloudChatSystemRow({
  row,
  renderChildRow,
}: {
  row: CloudChatTranscriptRowView;
  renderChildRow: (row: CloudChatTranscriptRowView) => ReactNode;
}) {
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
        className="flex h-auto w-full justify-start gap-2 rounded-none bg-transparent px-3 py-1.5 text-left font-sans text-chat leading-[var(--text-chat--line-height)] text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground"
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
              className="whitespace-pre-wrap rounded-md border border-border bg-card px-3.5 py-2.5 font-sans text-[length:var(--text-chat)] leading-[var(--text-chat--line-height)] text-muted-foreground select-text"
              data-telemetry-mask
            >
              {body}
            </div>
          ) : null}
          {children.length > 0 ? (
            <div className="space-y-1.5">
              {children.map((child) => (
                <Fragment key={child.id}>{renderChildRow(child)}</Fragment>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export function CloudChatErrorRow({ row }: { row: CloudChatTranscriptRowView }) {
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
            <span className="text-chat leading-[var(--text-chat--line-height)] text-muted-foreground">{row.status}</span>
          ) : null}
          {hasDetails ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-chat-transcript-ignore
              onClick={() => setDetailsExpanded((value) => !value)}
              className="gap-1 px-1.5 text-chat leading-[var(--text-chat--line-height)] text-muted-foreground hover:text-foreground"
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
