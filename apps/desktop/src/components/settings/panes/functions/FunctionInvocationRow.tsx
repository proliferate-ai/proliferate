import { Badge } from "@proliferate/ui/primitives/Badge";
import { Button } from "@proliferate/ui/primitives/Button";
import { Switch } from "@proliferate/ui/primitives/Switch";
import type { FunctionInvocation } from "@proliferate/cloud-sdk/client/integrations";
import {
  functionInvocationChatScopeLabel,
  functionInvocationMethodLabel,
} from "@/lib/domain/settings/function-invocations-presentation";

interface FunctionInvocationRowProps {
  invocation: FunctionInvocation;
  togglingChatScope: boolean;
  onEdit: (invocation: FunctionInvocation) => void;
  onRotateHeaders: (invocation: FunctionInvocation) => void;
  onToggleChatScope: (invocation: FunctionInvocation, enabled: boolean) => void;
  onRequestDelete: (invocation: FunctionInvocation) => void;
}

/**
 * One function-invocation row: mono tool-address name, method/headers chips,
 * the §2 per-invocation default-access toggle (workflow-only vs enabled for
 * chat), and row actions. No colored edge treatment — quiet chips only, same
 * visual language as ``IntegrationRow``.
 */
export function FunctionInvocationRow({
  invocation,
  togglingChatScope,
  onEdit,
  onRotateHeaders,
  onToggleChatScope,
  onRequestDelete,
}: FunctionInvocationRowProps) {
  return (
    <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1.4fr)_minmax(0,11rem)_auto] items-start gap-3 border-b border-border py-3 last:border-b-0">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-mono text-sm font-medium text-foreground">
            {invocation.name}
          </span>
          <Badge tone="neutral">{functionInvocationMethodLabel(invocation.method)}</Badge>
        </div>
        {invocation.displayName ? (
          <div className="mt-0.5 truncate text-sm text-muted-foreground">
            {invocation.displayName}
          </div>
        ) : null}
      </div>

      <div className="min-w-0">
        <div className="truncate text-sm text-muted-foreground">{invocation.endpointUrl}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {invocation.hasHeaders ? "Headers: •••• set" : "Headers: none"}
        </div>
      </div>

      <div className="flex items-center justify-end gap-2">
        <Badge tone={invocation.chatScopeEnabled ? "info" : "neutral"}>
          {functionInvocationChatScopeLabel(invocation.chatScopeEnabled)}
        </Badge>
        <Switch
          aria-label={`${invocation.name} enabled for chat`}
          checked={invocation.chatScopeEnabled}
          disabled={togglingChatScope}
          onChange={(value) => onToggleChatScope(invocation, value)}
        />
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" className="min-w-16" onClick={() => onEdit(invocation)}>
          Edit
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-w-28"
          onClick={() => onRotateHeaders(invocation)}
        >
          {invocation.hasHeaders ? "Rotate headers" : "Set headers"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-w-16"
          onClick={() => onRequestDelete(invocation)}
        >
          Delete
        </Button>
      </div>
    </div>
  );
}
