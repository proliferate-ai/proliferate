import type { ReactNode } from "react";
import { AutoHideScrollArea } from "@/components/ui/layout/AutoHideScrollArea";
import { Settings, Sparkles } from "@/components/ui/icons";
import { ToolActionDetailsPanel } from "@/components/workspace/chat/tool-calls/ToolActionDetailsPanel";
import { ToolActionRow } from "@/components/workspace/chat/tool-calls/ToolActionRow";
import { TOOL_CALL_BODY_MAX_HEIGHT_CLASS } from "@proliferate/product-domain/chats/tools/tool-call-layout";

export function TranscriptPreviewShell({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-3">{children}</div>;
}

export function TransientStatusRow({ text }: { text: string }) {
  return (
    <div className="flex min-h-[calc(var(--text-chat--line-height)+1.5rem)] items-start gap-2 py-1 text-xs text-muted-foreground">
      <Sparkles className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0 truncate">{text}</span>
    </div>
  );
}

export function HookPreview({
  status,
  name = "Hook",
  title,
  body,
}: {
  status: "running" | "completed" | "failed";
  name?: string;
  title: string;
  body: string;
}) {
  return (
    <ToolActionRow
      icon={<Settings className="size-3 text-faint" />}
      label={<span className="font-[460] text-foreground/90">{name}</span>}
      hint={title}
      status={status}
      defaultExpanded
    >
      <ToolActionDetailsPanel>
        <AutoHideScrollArea
          className="w-full"
          viewportClassName={TOOL_CALL_BODY_MAX_HEIGHT_CLASS}
        >
          <pre className="m-0 whitespace-pre-wrap px-3 py-2 font-mono text-[length:var(--readable-code-font-size)] leading-[var(--readable-code-line-height)] text-foreground">
            {body}
          </pre>
        </AutoHideScrollArea>
      </ToolActionDetailsPanel>
    </ToolActionRow>
  );
}
