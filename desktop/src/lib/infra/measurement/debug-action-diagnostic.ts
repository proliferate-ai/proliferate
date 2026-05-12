import { recordMeasurementDiagnostic } from "@/lib/infra/measurement/debug-measurement";
import { isDebugMeasurementEnabled } from "@/lib/infra/measurement/debug-measurement-env";

export function recordDebugActionDiagnostic({
  category,
  label,
  keys,
  detail,
}: {
  category: string;
  label: string;
  keys?: readonly string[];
  detail?: Record<string, unknown>;
}): void {
  if (!isDebugMeasurementEnabled()) {
    return;
  }

  recordMeasurementDiagnostic({
    category,
    label,
    keys,
    count: keys?.length,
    detail: JSON.stringify({
      ...detail,
      stack: captureActionStack(),
    }),
  });
}

function captureActionStack(): string[] {
  const stack = new Error().stack;
  if (!stack) {
    return [];
  }
  return stack
    .split("\n")
    .slice(2)
    .map((line) => line.trim())
    .filter((line) =>
      line.length > 0
      && !line.includes("debug-action-diagnostic")
      && !line.includes("debug-measurement")
    )
    .slice(0, 8);
}
