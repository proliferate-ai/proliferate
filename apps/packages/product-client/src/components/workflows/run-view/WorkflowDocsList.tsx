import type { WorkflowRunDocV2, WorkflowRunNodeV2 } from "@anyharness/sdk";
import { formatRelativeTime } from "#product/lib/domain/workspaces/display/workspace-display";
import { RosterRow } from "#product/primitives/patterns/RosterRow";

/** Established fallback for an unresolved reference value across the product (`ModelTable`, `WorkspaceReconciliationBody`, the update playground). */
const UNRESOLVED_NODE_LABEL = "—";

export interface WorkflowDocsListProps {
  docs: WorkflowRunDocV2[];
  nodesById: ReadonlyMap<string, WorkflowRunNodeV2>;
  onOpenDoc: (doc: WorkflowRunDocV2) => void;
}

/**
 * The run view's context-doc roster. Each row opens the real file on disk
 * (via `useWorkflowDocOpen`, composed by the caller into `onOpenDoc`) — never
 * a widget mock or fetched-into-a-bespoke-renderer preview.
 *
 * Composes `RosterRow` (the shape `WorkflowRunList`/`WorkflowRunDetail`
 * already use for this area's other rosters) rather than a bespoke file row:
 * filename as the selectable title, the producing node's title as the
 * secondary line (or the product's standard "—" when the node id does not
 * resolve — a doc predating the node that would have produced it, or a
 * template-seeded doc with no producing node at all), and the doc's relative
 * `updatedAt` as always-visible trailing meta.
 *
 * Empty `docs` renders nothing: the parent surface owns the empty-state copy
 * for "no context docs yet".
 */
export function WorkflowDocsList({ docs, nodesById, onOpenDoc }: WorkflowDocsListProps) {
  if (docs.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-0.5">
      {docs.map((doc) => {
        const producingNode = doc.producingNodeRowId
          ? nodesById.get(doc.producingNodeRowId)
          : undefined;
        return (
          <RosterRow
            key={doc.id}
            density="comfortable"
            title={<span className="font-mono">{doc.filename}</span>}
            secondary={producingNode?.title ?? UNRESOLVED_NODE_LABEL}
            trailing={formatRelativeTime(doc.updatedAt)}
            onSelect={() => onOpenDoc(doc)}
          />
        );
      })}
    </div>
  );
}
