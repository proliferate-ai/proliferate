import type { WorkflowDocTemplateV2, WorkflowNodeV2 } from "@proliferate/cloud-sdk";
import { WORKFLOW_BUILDER_COPY } from "#product/copy/workflows/workflow-builder-copy";
import type { WorkflowBuilderIssue } from "#product/lib/domain/workflows/workflow-builder-validation";
import { Button } from "#product/primitives/Button";
import { Input } from "#product/primitives/Input";
import { Label } from "#product/primitives/Label";
import { Select } from "#product/primitives/Select";
import { Textarea } from "#product/primitives/Textarea";

export interface WorkflowBuilderDocInspectorProps {
  doc: WorkflowDocTemplateV2;
  /** The doc's index in the draft; field ids and positional issues key on it. */
  index: number;
  /** Chain-ordered nodes; the producing-node select offers exactly these. */
  nodes: readonly WorkflowNodeV2[];
  /** Every issue; the inspector selects its own by slug, node id or index. */
  issues: readonly WorkflowBuilderIssue[];
  disabled: boolean;
  onRemove: () => void;
  onChange: (patch: Partial<WorkflowDocTemplateV2>) => void;
}

/**
 * One context document, as the right pane's inspector: the slug prompts spell
 * (`@doc:slug`), which step writes it, and the body it starts from. The
 * producing-node select is bound to the current chain rather than free text,
 * so the only way to reach `unknown_producing_node` is to delete the step
 * afterwards — which the validator then reports here.
 */
export function WorkflowBuilderDocInspector({
  doc,
  index,
  nodes,
  issues,
  disabled,
  onRemove,
  onChange,
}: WorkflowBuilderDocInspectorProps) {
  const fieldPrefix = `workflow-builder-doc-${index}`;
  const ownIssues = issuesForDoc(issues, doc, index);
  const producingNodeMissing = doc.producingNodeId.length > 0
    && !nodes.some((node) => node.id === doc.producingNodeId);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor={`${fieldPrefix}-slug`}>{WORKFLOW_BUILDER_COPY.docSlugLabel}</Label>
        <Input
          id={`${fieldPrefix}-slug`}
          value={doc.slug}
          disabled={disabled}
          aria-invalid={ownIssues.some((issue) =>
            issue.code === "duplicate_doc_slug" || issue.code === "invalid_doc_slug")
            ? "true"
            : undefined}
          placeholder={WORKFLOW_BUILDER_COPY.docSlugPlaceholder}
          // The draft normalizes what the grammar can only ever reject — case
          // and surrounding whitespace — so the field shows the value that
          // will be saved and checked.
          onChange={(event) => onChange({ slug: event.currentTarget.value })}
        />
      </div>

      <div>
        <Label htmlFor={`${fieldPrefix}-producing-node`}>
          {WORKFLOW_BUILDER_COPY.docProducingNodeLabel}
        </Label>
        <Select
          id={`${fieldPrefix}-producing-node`}
          value={doc.producingNodeId}
          disabled={disabled}
          aria-invalid={producingNodeMissing ? "true" : undefined}
          onChange={(event) => onChange({ producingNodeId: event.currentTarget.value })}
        >
          <option value="">{WORKFLOW_BUILDER_COPY.docProducingNodePlaceholder}</option>
          {producingNodeMissing ? (
            <option value={doc.producingNodeId}>
              {WORKFLOW_BUILDER_COPY.docProducingNodeUnavailableOption(doc.producingNodeId)}
            </option>
          ) : null}
          {nodes.map((node, nodeIndex) => (
            <option key={node.id} value={node.id}>
              {WORKFLOW_BUILDER_COPY.docProducingNodeOption(nodeIndex + 1, node.title)}
            </option>
          ))}
        </Select>
      </div>

      <div>
        <Label htmlFor={`${fieldPrefix}-body`}>{WORKFLOW_BUILDER_COPY.docBodyLabel}</Label>
        <Textarea
          id={`${fieldPrefix}-body`}
          value={doc.body}
          rows={8}
          disabled={disabled}
          placeholder={WORKFLOW_BUILDER_COPY.docBodyPlaceholder}
          onChange={(event) => onChange({ body: event.currentTarget.value })}
        />
      </div>

      {ownIssues.length > 0 ? (
        <div className="space-y-1" role="alert">
          {ownIssues.map((issue, issueIndex) => (
            <p key={`${issue.code}:${issueIndex}`} className="text-ui text-destructive">
              {issue.message}
            </p>
          ))}
        </div>
      ) : null}

      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="text-destructive hover:text-destructive"
          aria-label={WORKFLOW_BUILDER_COPY.removeDocLabel(doc.slug || String(index + 1))}
          disabled={disabled}
          onClick={onRemove}
        >
          {WORKFLOW_BUILDER_COPY.removeDocButtonLabel}
        </Button>
      </div>
    </div>
  );
}

/**
 * Issues that belong on this doc. `duplicate_doc_slug` and
 * `unknown_producing_node` carry their subject in `ref` and are matched on the
 * doc's own values, because the validator reports no index for either;
 * `invalid_doc_slug` is positional, since a blank slug would otherwise match
 * every blank doc.
 */
function issuesForDoc(
  issues: readonly WorkflowBuilderIssue[],
  doc: WorkflowDocTemplateV2,
  index: number,
): WorkflowBuilderIssue[] {
  return issues.filter((issue) =>
    (issue.code === "duplicate_doc_slug" && issue.ref === doc.slug)
    || (issue.code === "unknown_producing_node" && issue.ref === doc.producingNodeId)
    || (issue.code === "invalid_doc_slug" && issue.index === index));
}
