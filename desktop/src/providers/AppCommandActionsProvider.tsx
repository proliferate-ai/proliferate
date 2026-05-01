import { createContext, useContext, type ReactNode } from "react";
import type { AppCommandActions } from "@/hooks/app/use-app-command-actions";

const AppCommandActionsContext = createContext<AppCommandActions | null>(null);

export function AppCommandActionsProvider({
  value,
  children,
}: {
  value: AppCommandActions;
  children: ReactNode;
}) {
  return (
    <AppCommandActionsContext.Provider value={value}>
      {children}
    </AppCommandActionsContext.Provider>
  );
}

export function useAppCommandActionsContext(): AppCommandActions {
  const value = useContext(AppCommandActionsContext);
  if (!value) {
    throw new Error("useAppCommandActionsContext must be used inside AppCommandActionsProvider");
  }
  return value;
}
