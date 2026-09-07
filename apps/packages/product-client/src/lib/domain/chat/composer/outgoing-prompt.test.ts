import { describe, expect, it } from "vitest";
import {
  createTextDraft,
  serializeChatDraftToPrompt,
} from "#product/lib/domain/chat/composer/file-mention-draft-model";
import { serializeChatDraftToOutgoingPrompt } from "#product/lib/domain/chat/composer/outgoing-prompt";

describe("serializeChatDraftToOutgoingPrompt", () => {
  it("resolves context-doc tokens only in the outgoing prompt", () => {
    const draft = createTextDraft(
      "Read [01-plan.md](@doc:run-01j8/01-plan.md) and [setup.md](docs/setup.md)",
    );
    // The draft's own markdown keeps the token so the editor round-trips it
    // back into a chip; only the outgoing form resolves it to the on-disk path.
    expect(serializeChatDraftToPrompt(draft))
      .toBe("Read [01-plan.md](@doc:run-01j8/01-plan.md) and [setup.md](docs/setup.md)");
    expect(serializeChatDraftToOutgoingPrompt(draft))
      .toBe("Read [01-plan.md](.proliferate/context/01-plan.md) and [setup.md](docs/setup.md)");
  });

  it("passes a token-free draft through unchanged", () => {
    const draft = createTextDraft("plain text with [setup.md](docs/setup.md)");
    expect(serializeChatDraftToOutgoingPrompt(draft))
      .toBe(serializeChatDraftToPrompt(draft));
  });
});
