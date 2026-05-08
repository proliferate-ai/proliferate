import {
  createContext,
  useContext,
  type ReactNode,
} from "react";

const EMPTY_PROPOSED_PLAN_TOOL_CALL_IDS = new Set<string>();

const ProposedPlanToolCallIdsContext = createContext<ReadonlySet<string>>(
  EMPTY_PROPOSED_PLAN_TOOL_CALL_IDS,
);

export function ProposedPlanToolCallIdsProvider({
  value,
  children,
}: {
  value: ReadonlySet<string>;
  children: ReactNode;
}) {
  return (
    <ProposedPlanToolCallIdsContext.Provider value={value}>
      {children}
    </ProposedPlanToolCallIdsContext.Provider>
  );
}

export function useProposedPlanToolCallIds(): ReadonlySet<string> {
  return useContext(ProposedPlanToolCallIdsContext);
}
