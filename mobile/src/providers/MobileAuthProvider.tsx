import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useState,
} from "react";

export type MobileAuthState = "signed_out" | "needs_github" | "active";

interface MobileAuthContextValue {
  authState: MobileAuthState;
  signInWithGitHub: () => void;
  signOut: () => void;
}

const MobileAuthContext = createContext<MobileAuthContextValue | null>(null);

export function MobileAuthProvider({ children }: { children: ReactNode }) {
  const [authState, setAuthState] = useState<MobileAuthState>("signed_out");

  const value = useMemo<MobileAuthContextValue>(
    () => ({
      authState,
      signInWithGitHub() {
        setAuthState("active");
      },
      signOut() {
        setAuthState("signed_out");
      },
    }),
    [authState],
  );

  return (
    <MobileAuthContext.Provider value={value}>
      {children}
    </MobileAuthContext.Provider>
  );
}

export function useMobileAuth() {
  const value = useContext(MobileAuthContext);
  if (!value) {
    throw new Error("useMobileAuth must be used within MobileAuthProvider.");
  }
  return value;
}
