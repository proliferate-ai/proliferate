import { AUTOMATION_EXECUTION_TARGET_VALUES } from "@/config/automations";

export const AUTOMATION_EXECUTION_TARGET_OPTIONS = AUTOMATION_EXECUTION_TARGET_VALUES.map((value) => ({
  value,
  label: value === "cloud" ? "Cloud" : "Local",
}));
