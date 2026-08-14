import type { WorkflowDocTemplateV2, WorkflowNodeV2 } from "@proliferate/cloud-sdk";
import { WORKFLOW_BUILDER_COPY } from "#product/copy/workflows/workflow-builder-copy";
import type { DefinitionV2Issue } from "#product/domain/workflows/definition-v2";
import { Button } from "#product/primitives/Button";
import { Plus, Trash } from "#product/primitives/icons/core";
import { Input } from "#product/primitives/Input";
import { Label } from "#product/primitives/Label";
import { Card } from "#product/primitives/patterns/Card";
import { NoticeBanner } from "#product/primitives/patterns/NoticeBanner";
import { Select } from "#product/primitives/Select";
import { Textarea } from "#product/primitives/Textarea";

export interface WorkflowBuilderDocsPanelProps {
  docTemplates: readonly WorkflowDocTemplateV2[];
  /** Chain-ordered nodes; the producing-node select offers exactly these. */
  nodes: readonly WorkflowNodeV2[];
  /** Validator issues carrying a doc slug or producing-node id in `ref`. */
  issues: readonly DefinitionV2Issue[];
  disabled: boolean;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onChange: (index: number, patch: Partial<WorkflowDocTemplateV2>) => void;
}

/**
 * The documents steps hand work forward through. Each declares which step
 * writes it; every other step reads it as `@doc:slug`. The producing-node
 * select is bound to the current chain rather than free text, so the only way
 * to reach `unknown_producing_node` is to delete the step afterwards — which
 * the validator then reports on the row.
 */
export function WorkflowBuilderDocsPanel({
  docTemplates,
  nodes,
  issues,
  disabled,
  onAdd,
  onRemove,
  onChange,
}: WorkflowBuilderDocsPanelProps) {
  return (
    <Card as="section" surface="opaque" className="p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-heading font-medium text-foreground">
            {WORKFLOW_BUILDER_COPY.docsHeading}
          </h2>
          <p className="mt-0.5 text-ui-sm leading-4 text-muted-foreground">
            {WORKFLOW_BUILDER_COPY.docsDescription}
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled || nodes.length === 0}
          title={nodes.length === 0 ? WORKFLOW_BUILDER_COPY.docsNeedStep : undefined}
          onClick={onAdd}
        >
          <Plus className="icon-paired" aria-hidden />
          {WORKFLOW_BUILDER_COPY.addDocLabel}
        </Button>
      </div>

      {docTemplates.length === 0 ? (
        <NoticeBanner tone="neutral" className="mt-4">
          {WORKFLOW_BUILDER_COPY.docsEmpty}
        </NoticeBanner>
      ) : (
        <div className="mt-4 space-y-3">
          {docTemplates.map((doc, index) => (
            <WorkflowBuilderDocRow
              key={index}
              doc={doc}
              index={index}
              nodes={nodes}
              issues={issuesForDoc(issues, doc)}
              disabled={disabled}
              onRemove={() => onRemove(index)}
              onChange={(patch) => onChange(index, patch)}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

function WorkflowBuilderDocRow({
  doc,
  index,
  nodes,
  issues,
  disabled,
  onRemove,
  onChange,
}: {
  doc: WorkflowDocTemplateV2;
  index: number;
  nodes: readonly WorkflowNodeV2[];
  issues: readonly DefinitionV2Issue[];
  disabled: boolean;
  onRemove: () => void;
  onChange: (patch: Partial<WorkflowDocTemplateV2>) => void;
}) {
  const fieldPrefix = `workflow-builder-doc-${index}`;
  const producingNodeMissing = doc.producingNodeId.length > 0
    && !nodes.some((node) => node.id === doc.producingNodeId);

  return (
    <Card surface="tint" className="p-3">
      {/* Slug, producing step and remove need three lanes the spacing scale
          does not name: two equal free-width fields and an auto column the
          icon button sizes itself into. */}
      <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <Label htmlFor={`${fieldPrefix}-slug`}>{WORKFLOW_BUILDER_COPY.docSlugLabel}</Label>
          <Input
            id={`${fieldPrefix}-slug`}
            value={doc.slug}
            disabled={disabled}
            aria-invalid={issues.some((issue) => issue.code === "duplicate_doc_slug")
              ? "true"
              : undefined}
            placeholder={WORKFLOW_BUILDER_COPY.docSlugPlaceholder}
            onChange={(event) => onChange({ slug: event.currentTarget.value })}
          />
        </div>
        <div className="min-w-0">
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
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={WORKFLOW_BUILDER_COPY.removeDocLabel(doc.slug || String(index + 1))}
          disabled={disabled}
          onClick={onRemove}
        >
          <Trash className="icon-paired" aria-hidden />
        </Button>
      </div>

      <div className="mt-3">
        <Label htmlFor={`${fieldPrefix}-body`}>{WORKFLOW_BUILDER_COPY.docBodyLabel}</Label>
        <Textarea
          id={`${fieldPrefix}-body`}
          value={doc.body}
          rows={4}
          disabled={disabled}
          placeholder={WORKFLOW_BUILDER_COPY.docBodyPlaceholder}
          onChange={(event) => onChange({ body: event.currentTarget.value })}
        />
      </div>

      {issues.length > 0 ? (
        <div className="mt-2 space-y-1" role="alert">
          {issues.map((issue, issueIndex) => (
            <p key={`${issue.code}:${issueIndex}`} className="text-ui text-destructive">
              {issue.message}
            </p>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

/**
 * Issues that belong on this row. Both codes carry their subject in `ref`:
 * `duplicate_doc_slug` the slug, `unknown_producing_node` the missing node id
 * — matched on the row's own values rather than on position, because the
 * validator never reports an index.
 */
function issuesForDoc(
  issues: readonly DefinitionV2Issue[],
  doc: WorkflowDocTemplateV2,
): DefinitionV2Issue[] {
  return issues.filter((issue) =>
    (issue.code === "duplicate_doc_slug" && issue.ref === doc.slug)
    || (issue.code === "unknown_producing_node" && issue.ref === doc.producingNodeId));
}
