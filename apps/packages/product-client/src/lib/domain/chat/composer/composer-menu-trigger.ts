import {
  findFileMentionTrigger,
  type FileMentionTrigger,
} from "#product/lib/domain/chat/composer/file-mention-search";
import {
  findSlashCommandTrigger,
  type SlashCommandTrigger,
} from "#product/lib/domain/chat/composer/slash-command-draft-edits";

export type ComposerMenuTrigger =
  | ({ kind: "slash" } & SlashCommandTrigger)
  | ({ kind: "mention" } & FileMentionTrigger);

/**
 * Resolves which inline composer menu the caret is currently in.
 *
 * The two menus are mutually exclusive by construction: a slash trigger only
 * exists at the very start of the prompt, and a mention trigger requires the
 * token to open with "@". Resolving them in one place keeps the composer from
 * ever opening both panels at once, and gives the keyboard handlers a single
 * value to branch on.
 */
export function findComposerMenuTrigger(
  text: string,
  selectionOffset: number,
): ComposerMenuTrigger | null {
  const slash = findSlashCommandTrigger(text, selectionOffset);
  if (slash) {
    return { kind: "slash", ...slash };
  }
  const mention = findFileMentionTrigger(text, selectionOffset);
  if (mention) {
    return { kind: "mention", ...mention };
  }
  return null;
}
