import { AutoHideScrollArea } from "@proliferate/ui/layout/AutoHideScrollArea";
import { ProliferateIcon } from "@proliferate/ui/proliferate-icons";
import { MarkdownRenderer } from "@/components/content/ui/MarkdownRenderer";
import { TOOL_CALL_BODY_MAX_HEIGHT_CLASS } from "@proliferate/product-domain/chats/tools/tool-call-layout";
import type { SkillsToolResultPresentation } from "@proliferate/product-domain/chats/tools/skills-tool-result";
import { ToolActionDetailsPanel } from "./ToolActionDetailsPanel";
import { ToolActionRow, type ToolActionStatus } from "./ToolActionRow";

interface SkillsToolResultRowProps {
  presentation: SkillsToolResultPresentation;
  status: ToolActionStatus;
}

export function SkillsToolResultRow({
  presentation,
  status,
}: SkillsToolResultRowProps) {
  return (
    <ToolActionRow
      icon={<ProliferateIcon className="size-3 text-faint" />}
      label={labelFor(presentation)}
      hint={hintFor(presentation)}
      status={status}
      expandable
    >
      <ToolActionDetailsPanel>
        <AutoHideScrollArea
          className="w-full"
          viewportClassName={TOOL_CALL_BODY_MAX_HEIGHT_CLASS}
        >
          <SkillsToolResultDetails presentation={presentation} />
        </AutoHideScrollArea>
      </ToolActionDetailsPanel>
    </ToolActionRow>
  );
}

function SkillsToolResultDetails({
  presentation,
}: {
  presentation: SkillsToolResultPresentation;
}) {
  switch (presentation.kind) {
    case "list":
      return (
        <div className="space-y-2 px-3 py-2 text-chat leading-[var(--text-chat--line-height)]">
          {presentation.skills.length > 0 ? (
            presentation.skills.map((skill) => (
              <div key={skill.skillId} className="space-y-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 truncate font-[520] text-foreground">
                    {skill.displayName}
                  </span>
                  <MetadataPill>{skill.skillId}</MetadataPill>
                </div>
                <p className="m-0 text-muted-foreground">
                  {skill.description}
                </p>
                <MetadataLine
                  servers={skill.requiredMcpServers}
                  resourceCount={skill.resourceCount}
                />
              </div>
            ))
          ) : (
            <p className="m-0 text-muted-foreground">No skills are available for this session.</p>
          )}
        </div>
      );
    case "activate":
      return (
        <div className="space-y-3 px-3 py-2 text-chat leading-[var(--text-chat--line-height)]">
          <div className="space-y-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 truncate font-[520] text-foreground">
                {presentation.displayName}
              </span>
              <MetadataPill>{presentation.skillId}</MetadataPill>
            </div>
            <p className="m-0 text-muted-foreground">
              {presentation.description}
            </p>
            <MetadataLine
              servers={presentation.requiredMcpServers}
              credentials={presentation.credentialBindingIds}
              resourceCount={presentation.resources.length}
            />
          </div>
          <MarkdownRenderer
            content={presentation.instructions}
            className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
          />
          {presentation.resources.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 border-t border-border/60 pt-2">
              {presentation.resources.map((resource) => (
                <MetadataPill key={resource.resourceId}>
                  {resource.displayName ?? resource.resourceId}
                </MetadataPill>
              ))}
            </div>
          ) : null}
        </div>
      );
    case "resource":
      return (
        <div className="space-y-2 px-3 py-2 text-chat leading-[var(--text-chat--line-height)]">
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate font-[520] text-foreground">
              {presentation.displayName ?? presentation.resourceId}
            </span>
            <MetadataPill>{`${presentation.skillId}/${presentation.resourceId}`}</MetadataPill>
          </div>
          {presentation.contentType.includes("markdown") ? (
            <MarkdownRenderer
              content={presentation.content}
              className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
            />
          ) : (
            <pre className="m-0 whitespace-pre-wrap font-mono text-[length:var(--readable-code-font-size)] leading-[var(--readable-code-line-height)] text-foreground">
              {presentation.content}
            </pre>
          )}
        </div>
      );
  }
}

function MetadataLine({
  servers,
  credentials,
  resourceCount,
}: {
  servers?: readonly string[];
  credentials?: readonly string[];
  resourceCount?: number | null;
}) {
  const items = [
    servers && servers.length > 0 ? `${servers.join(", ")} MCP` : null,
    credentials && credentials.length > 0 ? `${credentials.length} credential` : null,
    typeof resourceCount === "number"
      ? `${resourceCount} ${resourceCount === 1 ? "resource" : "resources"}`
      : null,
  ].filter((item): item is string => !!item);

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => <MetadataPill key={item}>{item}</MetadataPill>)}
    </div>
  );
}

function MetadataPill({ children }: { children: string }) {
  return (
    <span
      title={children}
      className="max-w-[260px] truncate rounded-sm border border-border/60 bg-muted/45 px-1.5 py-0.5 font-mono text-[0.625rem] leading-none text-muted-foreground"
    >
      {children}
    </span>
  );
}

function labelFor(presentation: SkillsToolResultPresentation): string {
  switch (presentation.kind) {
    case "list":
      return "Skills listed";
    case "activate":
      return "Skill activated";
    case "resource":
      return "Skill resource loaded";
  }
}

function hintFor(presentation: SkillsToolResultPresentation): string {
  switch (presentation.kind) {
    case "list":
      return "Skills";
    case "activate":
      return presentation.skillId;
    case "resource":
      return `${presentation.skillId}/${presentation.resourceId}`;
  }
}
