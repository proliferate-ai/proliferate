import type { NavigateOptions, To } from "react-router-dom";

type AppNavigate = (to: To, options?: NavigateOptions) => void;

// The latest router navigate, registered by AuthenticatedAppHost — the one
// authenticated component that must subscribe to the router location anyway.
// Callback-only consumers (the Run command, command palette entries) navigate
// through navigateApp instead of calling useNavigate, because in
// declarative-router mode useNavigate subscribes its caller to every location
// change — which re-rendered the whole workspace shell on each Settings
// section click (PRO-170).
let appNavigate: AppNavigate | null = null;

export function setAppNavigate(navigate: AppNavigate | null): void {
  appNavigate = navigate;
}

export function navigateApp(to: To, options?: NavigateOptions): void {
  appNavigate?.(to, options);
}
