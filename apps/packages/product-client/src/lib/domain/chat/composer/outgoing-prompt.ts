import { resolveContextDocMentionTokens } from "#product/lib/domain/chat/composer/context-doc-mention";
import {
  serializeChatDraftToPrompt,
  type ChatComposerDraft,
} from "#product/lib/domain/chat/composer/file-mention-draft-model";

/**
 * The prompt actually sent to the agent. `serializeChatDraftToPrompt` is the
 * draft's own markdown and keeps context-doc mention tokens intact so the
 * editor round-trips them back into chips; the outgoing form is where those
 * tokens resolve to the concrete workspace path the agent can read. Send
 * sites call this, everything that feeds text back into the editor must not.
 *
 * Deliberately NOT part of `file-mention-draft-model`: the draft model rides
 * in the entry chunk (the chat input store persists drafts at boot), and this
 * module's context-doc dependency belongs to the lazy workspace surface. The
 * split is what keeps the login first-load budget untouched.
 */
export function serializeChatDraftToOutgoingPrompt(draft: ChatComposerDraft): string {
  return resolveContextDocMentionTokens(serializeChatDraftToPrompt(draft));
}
