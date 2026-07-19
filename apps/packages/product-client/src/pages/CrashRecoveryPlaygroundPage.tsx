import type { AppErrorBoundaryProps } from "#product/components/app/AppErrorBoundary";
import { AppErrorBoundary } from "#product/components/app/AppErrorBoundary";

type Scenario =
  | "reporting"
  | "reported"
  | "failed"
  | "unavailable"
  | "exception"
  | "retry";

const SCENARIOS = new Set<Scenario>([
  "reporting",
  "reported",
  "failed",
  "unavailable",
  "exception",
  "retry",
]);
const PLAYGROUND_ERROR = new Error("Workspace panel failed to render");
let retryShouldThrow = true;

function selectedScenario(): Scenario {
  const value = new URLSearchParams(window.location.search).get("scenario");
  return SCENARIOS.has(value as Scenario) ? (value as Scenario) : "unavailable";
}

function reporterFor(
  scenario: Scenario,
): AppErrorBoundaryProps["onRenderError"] {
  switch (scenario) {
    case "reporting":
      return () => new Promise<boolean>(() => {});
    case "reported":
      return async () => true;
    case "failed":
      return async () => false;
    case "exception":
      return () => {
        throw new Error("Playground reporter exception");
      };
    case "retry":
      return async () => {
        retryShouldThrow = false;
        return false;
      };
    case "unavailable":
      return undefined;
  }
}

function CrashRecoveryProbe({ scenario }: { scenario: Scenario }) {
  if (scenario !== "retry" || retryShouldThrow) throw PLAYGROUND_ERROR;
  return (
    <main className="flex min-h-screen items-center justify-center bg-background text-foreground">
      <p className="text-sm">Recovery retry succeeded.</p>
    </main>
  );
}

/** Dev-only deterministic render-crash states used for visual acceptance. */
export function CrashRecoveryPlaygroundPage() {
  const scenario = selectedScenario();
  return (
    <AppErrorBoundary
      onRenderError={reporterFor(scenario)}
      clientReleaseId="proliferate-web@0.1.0+ui08proof"
      onCopyDetails={async () => {}}
      onContactSupport={async () => {}}
    >
      <CrashRecoveryProbe scenario={scenario} />
    </AppErrorBoundary>
  );
}
