import type { ReactNode } from "react";
import { Label } from "@proliferate/ui/primitives/Label";

/** Shared field primitives for the workflow step editors (extracted from
 * `WorkflowStepPanel.tsx` so the per-kind editors can live in their own files
 * under the frontend line ratchet). */

export function FieldLabel({ children }: { children: ReactNode }) {
  return <Label>{children}</Label>;
}

/** Label-left inline row (Family-4 C): fixed-width muted label, control right. */
export function InlineRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="w-28 shrink-0 text-sm text-muted-foreground">{label}</span>
      <div className="flex flex-1 justify-end">{children}</div>
    </div>
  );
}
