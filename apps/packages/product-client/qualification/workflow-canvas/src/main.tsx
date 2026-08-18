import "@proliferate/design/product.css";

import type { WorkflowEdgeV2, WorkflowNodeV2 } from "@proliferate/cloud-sdk";
import { useState } from "react";
import ReactDOM from "react-dom/client";
import { WorkflowBuilderChainCanvas } from "#product/components/workflows/builder-v2/WorkflowBuilderChainCanvas";

const NODES: WorkflowNodeV2[] = [
  { id: "a", type: "agent", title: "A", prompt: "First" },
  { id: "c", type: "agent", title: "C", prompt: "Display-only middle card" },
  { id: "b", type: "agent", title: "B", prompt: "Last" },
];

// Depth invariants are not doubled here: this fixture mounts the production
// WorkflowBuilderChainCanvas/WorkflowCanvas, production CSS and transform,
// production DOM order, and production callbacks. It supplies only the legal
// [a, c, b] document state needed to expose the crossing-edge layout.
function WorkflowCanvasDepthFixture() {
  const [edges, setEdges] = useState<WorkflowEdgeV2[]>([{ from: "a", to: "b" }]);
  const [inputConnectedTo, setInputConnectedTo] = useState<string | null>("a");

  return (
    <main style={{ width: 720, height: 680, margin: "0 auto", padding: 16 }}>
      <WorkflowBuilderChainCanvas
        className="h-full"
        nodes={NODES}
        edges={edges}
        inputConnectedTo={inputConnectedTo}
        harnesses={[]}
        selectedNodeId={null}
        inputSelected={false}
        issueNodeIds={new Set()}
        onSelectNode={() => {}}
        onSelectInput={() => {}}
        onConnectNodes={(from, to) => setEdges((current) => [...current, { from, to }])}
        onConnectInput={setInputConnectedTo}
        onRemoveEdge={(from, to) => setEdges((current) => current.filter(
          (edge) => edge.from !== from || edge.to !== to,
        ))}
        onDisconnectInput={() => setInputConnectedTo(null)}
      />
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <WorkflowCanvasDepthFixture />,
);
