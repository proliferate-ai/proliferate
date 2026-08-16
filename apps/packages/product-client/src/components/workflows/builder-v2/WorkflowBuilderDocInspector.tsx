import type { WorkflowDocTemplateV2, WorkflowNodeV2 } from "@proliferate/cloud-sdk";
import { WORKFLOW_BUILDER_COPY } from "#product/copy/workflows/workflow-builder-copy";
import type { WorkflowBuilderIssue } from "#product/lib/domain/workflows/workflow-builder-validation";
import {
  INSPECTOR_DESTRUCTIVE_BUTTON_STYLE,
  INSPECTOR_EYEBROW_CLASS,
  INSPECTOR_EYEBROW_STYLE,
  INSPECTOR_FIELD_CLASS,
  INSPECTOR_FIELD_STYLE,
  INSPECTOR_TEXTAREA_STYLE,
} from "#product/components/workflows/builder-v2/WorkflowBuilderNodeInspector";
import { X } from "#product/primitives/icons/core";

export interface WorkflowBuilderDocInspectorProps {
  doc: WorkflowDocTemplateV2;
  /** The doc's index in the draft; field ids and positional issues key on it. */
  index: number;
  /** Chain-ordered nodes; the producing-node select offers exactly these. */
  nodes: readonly WorkflowNodeV2[];
  /** Every issue; the inspector selects its own by slug, node id or index. */
  issues: readonly WorkflowBuilderIssue[];
  disabled: boolean;
  onClose: () => void;
  onRemove: () => void;
  onChange: (patch: Partial<WorkflowDocTemplateV2>) => void;
}

/**
 * One context document in the right pane, in the design's doc-inspector
 * anatomy: the Markdown eyebrow with its close affordance, the mono slug
 * field with a word-count meta line, the contents editor, and Remove doc.
 * The written-by select is the contract's addition — a doc template must
 * name the step that writes it — presented in the same field chrome.
 */
export function WorkflowBuilderDocInspector({
  doc,
  index,
  nodes,
  issues,
  disabled,
  onClose,
  onRemove,
  onChange,
}: WorkflowBuilderDocInspectorProps) {
  const fieldPrefix = `workflow-builder-doc-${index}`;
  const ownIssues = issuesForDoc(issues, doc, index);
  const producingNodeMissing = doc.producingNodeId.length > 0
    && !nodes.some((node) => node.id === doc.producingNodeId);
  const words = doc.body.trim().length === 0 ? 0 : doc.body.trim().split(/\s+/).length;

  return (
    <div className="flex flex-col" style={{ gap: 14 }}>
      <div className="flex items-center" style={{ gap: 7 }}>
        <span
          className={INSPECTOR_EYEBROW_CLASS}
          style={{ ...INSPECTOR_EYEBROW_STYLE, letterSpacing: "0.06em" }}
        >
          {WORKFLOW_BUILDER_COPY.docKindLabel}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          title={WORKFLOW_BUILDER_COPY.docCloseLabel}
          aria-label={WORKFLOW_BUILDER_COPY.docCloseLabel}
          className="grid cursor-pointer place-items-center rounded-md border-0 bg-transparent text-faint hover:bg-hover hover:text-foreground"
          style={{ width: 22, height: 22 }}
          onClick={onClose}
        >
          <X className="icon-paired" aria-hidden />
        </button>
      </div>

      <div className="flex flex-col" style={{ gap: 6 }}>
        <input
          type="text"
          value={doc.slug}
          aria-label={WORKFLOW_BUILDER_COPY.docSlugLabel}
          aria-invalid={ownIssues.some((issue) =>
            issue.code === "duplicate_doc_slug" || issue.code === "invalid_doc_slug")
            ? "true"
            : undefined}
          placeholder={WORKFLOW_BUILDER_COPY.docSlugPlaceholder}
          disabled={disabled}
          spellCheck={false}
          className="text-ui-sm font-mono"
          style={INSPECTOR_FIELD_STYLE}
          // The draft normalizes what the grammar can only ever reject — case
          // and surrounding whitespace — so the field shows the value that
          // will be saved and checked.
          onChange={(event) => onChange({ slug: event.currentTarget.value })}
        />
        <span className="text-ui-sm text-faint">
          {WORKFLOW_BUILDER_COPY.docMeta(words)}
        </span>
      </div>

      <div className="flex flex-col" style={{ gap: 6 }}>
        <label
          htmlFor={`${fieldPrefix}-producing-node`}
          className={INSPECTOR_EYEBROW_CLASS}
          style={INSPECTOR_EYEBROW_STYLE}
        >
          {WORKFLOW_BUILDER_COPY.docProducingNodeLabel}
        </label>
        <select
          id={`${fieldPrefix}-producing-node`}
          value={doc.producingNodeId}
          disabled={disabled}
          aria-invalid={producingNodeMissing ? "true" : undefined}
          className={INSPECTOR_FIELD_CLASS}
          style={INSPECTOR_FIELD_STYLE}
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
        </select>
      </div>

      <div className="flex flex-col" style={{ gap: 6 }}>
        <label
          htmlFor={`${fieldPrefix}-body`}
          className={INSPECTOR_EYEBROW_CLASS}
          style={INSPECTOR_EYEBROW_STYLE}
        >
          {WORKFLOW_BUILDER_COPY.docContentsLabel}
        </label>
        <textarea
          id={`${fieldPrefix}-body`}
          value={doc.body}
          rows={12}
          disabled={disabled}
          spellCheck={false}
          placeholder={WORKFLOW_BUILDER_COPY.docBodyPlaceholder}
          className="text-ui-sm font-mono"
          style={{ ...INSPECTOR_TEXTAREA_STYLE, padding: "8px 9px" }}
          onChange={(event) => onChange({ body: event.currentTarget.value })}
        />
      </div>

      {ownIssues.length > 0 ? (
        <div className="space-y-1" role="alert">
          {ownIssues.map((issue, issueIndex) => (
            <p key={`${issue.code}:${issueIndex}`} className="text-ui m-0 text-destructive">
              {issue.message}
            </p>
          ))}
        </div>
      ) : null}

      <button
        type="button"
        aria-label={WORKFLOW_BUILDER_COPY.removeDocLabel(doc.slug || String(index + 1))}
        disabled={disabled}
        className="text-ui-sm hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
        style={INSPECTOR_DESTRUCTIVE_BUTTON_STYLE}
        onClick={onRemove}
      >
        {WORKFLOW_BUILDER_COPY.removeDocButtonLabel}
      </button>
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
