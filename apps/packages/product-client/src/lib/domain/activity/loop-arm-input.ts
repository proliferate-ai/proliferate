import type { LoopSchedule } from "#product/domain/activity/loop";

export interface LoopArmInput {
  prompt: string;
  schedule: LoopSchedule;
  recurring: boolean;
}
