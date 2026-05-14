const FRIENDLY_NAMES = [
  "Mary",
  "Allen",
  "Jeremy",
  "Nina",
  "Sam",
  "Priya",
  "Alex",
  "Maya",
];

const COLORS = [
  "bg-emerald-500",
  "bg-sky-500",
  "bg-rose-500",
  "bg-amber-500",
  "bg-violet-500",
  "bg-cyan-500",
  "bg-lime-500",
  "bg-fuchsia-500",
];

export interface DelegatedWorkVisualIdentity {
  avatarName: string;
  initial: string;
  colorClassName: string;
}

export function delegatedWorkVisualIdentity(id: string): DelegatedWorkVisualIdentity {
  const index = stableIndex(id);
  const avatarName = FRIENDLY_NAMES[index % FRIENDLY_NAMES.length] ?? "Mary";
  return {
    avatarName,
    initial: avatarName.slice(0, 1),
    colorClassName: COLORS[index % COLORS.length] ?? "bg-emerald-500",
  };
}

function stableIndex(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}
