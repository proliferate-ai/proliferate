export type ShortcutOwner = "js" | "native-menu";

interface ShortcutModifierMatch {
  meta: boolean;
  shift: boolean;
  alt: boolean;
  ctrl?: boolean;
}

export type ShortcutMatch =
  | ({
    kind: "fixed";
    key: string;
  } & ShortcutModifierMatch)
  | ({
    kind: "fixed-code";
    code: string;
  } & ShortcutModifierMatch)
  | ({
    kind: "digit-key";
  } & ShortcutModifierMatch)
  | ({
    kind: "digit-code";
  } & ShortcutModifierMatch);

export interface ShortcutDef<Id extends string = string> {
  id: Id;
  label: string;
  nonMacLabel?: string;
  description: string;
  owner: ShortcutOwner;
  match: ShortcutMatch;
  nonMacMatch?: ShortcutMatch;
  allowInInputs: boolean;
}

export interface ComposerShortcutDef {
  key: string;
  label: string;
  nonMacLabel?: string;
  description: string;
}
