import type { LoopSchedule } from "@proliferate/product-domain/activity/loop";

export interface LoopArmInput {
  prompt: string;
  schedule: LoopSchedule;
  recurring: boolean;
}
