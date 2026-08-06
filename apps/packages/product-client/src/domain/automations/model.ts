export type ProductAutomationStatus = "enabled" | "paused" | "failed";

export interface ProductAutomationSummary {
  id: string;
  name: string;
  description?: string | null;
  status: ProductAutomationStatus;
  runCount?: number | null;
}
