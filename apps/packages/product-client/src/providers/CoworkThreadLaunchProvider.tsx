import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { useCoworkThreadWorkflow } from "#product/hooks/cowork/workflows/use-cowork-thread-workflow";

type CreateCoworkThreadFromSelection = ReturnType<
  typeof useCoworkThreadWorkflow
>["createThreadFromSelection"];

interface CoworkThreadLaunchContextValue {
  desktopTargetsAvailable: boolean;
  createThreadFromSelection: CreateCoworkThreadFromSelection;
}

const CoworkThreadLaunchContext = createContext<
  CoworkThreadLaunchContextValue | undefined
>(undefined);

const unavailableCoworkThreadLaunch: CreateCoworkThreadFromSelection = async () => null;
const WEB_COWORK_THREAD_LAUNCH_CONTEXT: CoworkThreadLaunchContextValue = {
  desktopTargetsAvailable: false,
  createThreadFromSelection: unavailableCoworkThreadLaunch,
};

export function CoworkThreadLaunchProvider({ children }: { children: ReactNode }) {
  return useProductHost().desktop === null
    ? (
      <CoworkThreadLaunchContext.Provider value={WEB_COWORK_THREAD_LAUNCH_CONTEXT}>
        {children}
      </CoworkThreadLaunchContext.Provider>
    )
    : <DesktopCoworkThreadLaunchProvider>{children}</DesktopCoworkThreadLaunchProvider>;
}

function DesktopCoworkThreadLaunchProvider({ children }: { children: ReactNode }) {
  const { createThreadFromSelection } = useCoworkThreadWorkflow();
  const value = useMemo(
    () => ({ desktopTargetsAvailable: true, createThreadFromSelection }),
    [createThreadFromSelection],
  );
  return (
    <CoworkThreadLaunchContext.Provider value={value}>
      {children}
    </CoworkThreadLaunchContext.Provider>
  );
}

export function useCoworkThreadLaunchContext(): CoworkThreadLaunchContextValue {
  const value = useContext(CoworkThreadLaunchContext);
  if (!value) {
    throw new Error(
      "useCoworkThreadLaunchContext must be used inside CoworkThreadLaunchProvider",
    );
  }
  return value;
}
