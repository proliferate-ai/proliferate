import { twMerge } from "../utils/tw-merge";

type ClassValue = string | number | null | false | undefined | ClassValue[];

function flatten(values: ClassValue[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    if (!value && value !== 0) continue;
    if (Array.isArray(value)) {
      out.push(...flatten(value));
    } else {
      out.push(String(value));
    }
  }
  return out;
}

/** Join class values and resolve Tailwind conflicts (shadcn-style `cn`). */
export function cn(...values: ClassValue[]): string {
  return twMerge(flatten(values).join(" "));
}
