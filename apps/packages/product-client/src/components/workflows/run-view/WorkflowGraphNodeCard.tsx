import { useState } from "react";

import type {
  WorkflowGraphNodeVM,
  WorkflowNodeTone,
} from "#product/domain/workflows/run-view-model";
import { WORKFLOW_NODE_CARD_COPY } from "#product/copy/workflows/workflow-node-card-copy";
import { Badge } from "#product/primitives/Badge";
import { Button } from "#product/primitives/Button";
import { Label } from "#product/primitives/Label";
import { Card } from "#product/primitives/patterns/Card";
import { ModalShell } from "#product/primitives/patterns/ModalShell";
import { RosterRow } from "#product/primitives/patterns/RosterRow";
import { StatusDot, type StatusDotTone } from "#product/primitives/StatusDot";
import { Textarea } from "#product/primitives/Textarea";

/**
 * Maps the domain's node tone onto `StatusDot`'s tone axis — a local
 * `Record` at the component layer, the exact idiom `workflow-run-status-dot.tsx`
 * uses for the run/definition tone axis. Duplicated rather than shared
 * because the two tone vocabularies are different closed sets (this one has
 * `current`; the run/definition axis has `neutral`/`merged` in its place),
 * so a shared map would need a union wider than either caller's contract.
 */
const WORKFLOW_NODE_STATUS_DOT_TONE: Record<WorkflowNodeTone, StatusDotTone> = {
  muted: "muted",
  current: "current",
  info: "info",
  success: "success",
  warning: "warning",
  danger: "danger",
};

/**
 * Declared total above so a new tone is a compile error here, read partially
 * here so an unknown one is a muted dot rather than a crash. `StatusDot`
 * indexes its own tone map without a fallback, so an `undefined` tone throws
 * during render, and the client's single root `AppErrorBoundary` turns that
 * into whole-app crash recovery. The domain layer already lands an unknown node
 * status on `muted`; this is the same floor one layer up, for a `vm.tone` that
 * arrives from anywhere else.
 */
function statusDotToneFor(tone: WorkflowNodeTone): StatusDotTone {
  const byTone: Partial<Record<string, StatusDotTone>> = WORKFLOW_NODE_STATUS_DOT_TONE;
  return byTone[tone] ?? "muted";
}

export interface WorkflowGraphNodeCardProps {
  vm: WorkflowGraphNodeVM;
  /**
   * Visually subordinate rendering for a side node anchored under another
   * card: muted fill. Placement — the branch-rail indent — belongs to
   * `WorkflowGraphView`, the container that owns the graph's geometry.
   */
  secondary?: boolean;
  needsInput?: boolean;
  busy?: boolean;
  onFocusSession(nodeRowId: string): void;
  onApprove(nodeRowId: string): void;
  onFailRedo(nodeRowId: string, prompt?: string): void;
  onFlipType(nodeRowId: string, nodeType: "agent" | "human_in_loop"): void;
  onAddAdhoc(anchorNodeRowId: string, prompt: string): void;
}

/**
 * One node in the run's chain graph. Every control on the card is driven
 * solely by `vm.controls` (the ADR transition table, already resolved by
 * `run-view-model.ts`) — this component never re-derives eligibility from
 * `vm.node.status` itself, so a 409 from the runtime stays a race with the
 * run rather than a UI bug.
 */
export function WorkflowGraphNodeCard({
  vm,
  secondary = false,
  needsInput = false,
  busy = false,
  onFocusSession,
  onApprove,
  onFailRedo,
  onFlipType,
  onAddAdhoc,
}: WorkflowGraphNodeCardProps) {
  const [failRedoOpen, setFailRedoOpen] = useState(false);
  const [addAdhocOpen, setAddAdhocOpen] = useState(false);
  const { node, controls, isCurrent, tone } = vm;

  const hasControls = controls.approve
    || controls.failRedo
    || controls.flipToAgent
    || controls.flipToHuman
    || controls.addAdhoc;

  // The controls row is the card's footer slot, so `Card` draws the hairline
  // above it with the shared `border-t border-border` — the card owns its
  // internal edges, and a hand-drawn one here drifted to `border-border/60`.
  // Padding stays at the call site, which is `Card`'s contract.
  const controlsFooter = hasControls
    ? (
        <div className="flex flex-wrap items-center gap-2 px-3 pb-2.5 pt-2">
          {controls.approve ? (
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={busy}
              onClick={() => onApprove(node.id)}
            >
              {WORKFLOW_NODE_CARD_COPY.approveLabel}
            </Button>
          ) : null}
          {controls.failRedo ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => setFailRedoOpen(true)}
            >
              {WORKFLOW_NODE_CARD_COPY.failRedoLabel}
            </Button>
          ) : null}
          {controls.flipToAgent ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => onFlipType(node.id, "agent")}
            >
              {WORKFLOW_NODE_CARD_COPY.flipToAgentLabel}
            </Button>
          ) : null}
          {controls.flipToHuman ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => onFlipType(node.id, "human_in_loop")}
            >
              {WORKFLOW_NODE_CARD_COPY.flipToHumanLabel}
            </Button>
          ) : null}
          {controls.addAdhoc ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => setAddAdhocOpen(true)}
            >
              {WORKFLOW_NODE_CARD_COPY.addAdhocLabel}
            </Button>
          ) : null}
        </div>
      )
    : undefined;

  return (
    <>
      {/*
        The current node's emphasis is carried by its title weight (structure,
        not color, and not a shadow smuggled through a layout prop): `Card`
        owns elevation and exposes no shadow axis, so there is nothing
        sanctioned to pass it through.
      */}
      <Card surface={secondary ? "tint" : "opaque"} footer={controlsFooter}>
        <RosterRow
          density="comfortable"
          leading={<StatusDot tone={statusDotToneFor(tone)} />}
          title={(
            <span className={isCurrent ? "font-semibold" : undefined}>
              {WORKFLOW_NODE_CARD_COPY.nodeIndexTitle(node.chainIndex, node.title)}
            </span>
          )}
          secondary={(
            <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
              <span>{WORKFLOW_NODE_CARD_COPY.kindLine(node.nodeType, node.kind)}</span>
              {needsInput ? (
                <Badge tone="info" size="micro">
                  {WORKFLOW_NODE_CARD_COPY.needsInputBadge}
                </Badge>
              ) : null}
            </span>
          )}
          onSelect={() => onFocusSession(node.id)}
        />
      </Card>

      <WorkflowFailRedoDialog
        open={failRedoOpen}
        nodeId={node.id}
        originalPrompt={node.prompt}
        busy={busy}
        onClose={() => setFailRedoOpen(false)}
        onConfirm={(editedPrompt) => {
          onFailRedo(node.id, editedPrompt);
          setFailRedoOpen(false);
        }}
      />

      <WorkflowAddAdhocDialog
        open={addAdhocOpen}
        anchorNodeRowId={node.id}
        busy={busy}
        onClose={() => setAddAdhocOpen(false)}
        onConfirm={(prompt) => {
          onAddAdhoc(node.id, prompt);
          setAddAdhocOpen(false);
        }}
      />
    </>
  );
}

interface WorkflowFailRedoDialogProps {
  open: boolean;
  nodeId: string;
  originalPrompt: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: (editedPrompt: string | undefined) => void;
}

/**
 * The fail-and-redo prompt is prefilled with the node's own prompt and stays
 * editable before launch (the ADR's "editable-before-launch" rule): Confirm
 * hands back `undefined` when the caller never touched the text, so the
 * command only carries a prompt override when one was actually made.
 */
function WorkflowFailRedoDialog({
  open,
  nodeId,
  originalPrompt,
  busy,
  onClose,
  onConfirm,
}: WorkflowFailRedoDialogProps) {
  // Re-seeds from the node's own prompt whenever the dialog reopens (or opens
  // on a different node), the same derived-key idiom `WorkflowTriggerDialog`
  // uses for its argument draft, rather than an effect.
  const draftKey = `${nodeId}:${open}`;
  const [draft, setDraft] = useState({ key: draftKey, prompt: originalPrompt });
  const prompt = draft.key === draftKey ? draft.prompt : originalPrompt;
  const fieldId = `workflow-fail-redo-prompt-${nodeId}`;

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      disableClose={busy}
      title={WORKFLOW_NODE_CARD_COPY.failRedoDialogTitle}
      description={WORKFLOW_NODE_CARD_COPY.failRedoDialogDescription}
      sizeClassName="max-w-lg"
      footer={(
        <>
          <Button type="button" variant="ghost" size="md" disabled={busy} onClick={onClose}>
            {WORKFLOW_NODE_CARD_COPY.failRedoCancelLabel}
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            loading={busy}
            disabled={busy}
            onClick={() => onConfirm(prompt === originalPrompt ? undefined : prompt)}
          >
            {WORKFLOW_NODE_CARD_COPY.failRedoConfirmLabel}
          </Button>
        </>
      )}
    >
      <div>
        <Label htmlFor={fieldId}>{WORKFLOW_NODE_CARD_COPY.failRedoPromptLabel}</Label>
        <Textarea
          id={fieldId}
          value={prompt}
          rows={6}
          disabled={busy}
          onChange={(event) => setDraft({ key: draftKey, prompt: event.currentTarget.value })}
        />
      </div>
    </ModalShell>
  );
}

interface WorkflowAddAdhocDialogProps {
  open: boolean;
  anchorNodeRowId: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: (prompt: string) => void;
}

/** The ad hoc side-node prompt starts blank and is required to confirm. */
function WorkflowAddAdhocDialog({
  open,
  anchorNodeRowId,
  busy,
  onClose,
  onConfirm,
}: WorkflowAddAdhocDialogProps) {
  const draftKey = `${anchorNodeRowId}:${open}`;
  const [draft, setDraft] = useState({ key: draftKey, prompt: "" });
  const prompt = draft.key === draftKey ? draft.prompt : "";
  const trimmedPrompt = prompt.trim();
  const fieldId = `workflow-adhoc-prompt-${anchorNodeRowId}`;

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      disableClose={busy}
      title={WORKFLOW_NODE_CARD_COPY.addAdhocDialogTitle}
      description={WORKFLOW_NODE_CARD_COPY.addAdhocDialogDescription}
      sizeClassName="max-w-lg"
      footer={(
        <>
          <Button type="button" variant="ghost" size="md" disabled={busy} onClick={onClose}>
            {WORKFLOW_NODE_CARD_COPY.addAdhocCancelLabel}
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            loading={busy}
            disabled={busy || trimmedPrompt.length === 0}
            onClick={() => onConfirm(trimmedPrompt)}
          >
            {WORKFLOW_NODE_CARD_COPY.addAdhocConfirmLabel}
          </Button>
        </>
      )}
    >
      <div>
        <Label htmlFor={fieldId}>{WORKFLOW_NODE_CARD_COPY.addAdhocPromptLabel}</Label>
        <Textarea
          id={fieldId}
          value={prompt}
          rows={6}
          disabled={busy}
          placeholder={WORKFLOW_NODE_CARD_COPY.addAdhocPromptPlaceholder}
          onChange={(event) => setDraft({ key: draftKey, prompt: event.currentTarget.value })}
        />
      </div>
    </ModalShell>
  );
}
