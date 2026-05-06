import { describe, expect, it } from "vitest";
import { classifyPromptDispatchFailure } from "@/hooks/chat/use-prompt-outbox-dispatcher";

describe("classifyPromptDispatchFailure", () => {
  it("treats pre-request failures as not sent", () => {
    expect(classifyPromptDispatchFailure(new Error("File read failed"), false))
      .toMatchObject({
        deliveryState: "failed_before_dispatch",
        message: "File read failed",
      });
  });

  it("treats definitive post-request rejections as not sent", () => {
    expect(classifyPromptDispatchFailure({ response: { status: 409 } }, true))
      .toMatchObject({
        deliveryState: "failed_before_dispatch",
      });
  });

  it("treats opaque post-request failures as awaiting confirmation", () => {
    expect(classifyPromptDispatchFailure(new Error("NetworkError"), true))
      .toMatchObject({
        deliveryState: "unknown_after_dispatch",
      });
  });
});
