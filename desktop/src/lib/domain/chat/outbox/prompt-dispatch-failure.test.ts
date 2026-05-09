import { describe, expect, it } from "vitest";
import { classifyPromptDispatchFailure } from "./prompt-dispatch-failure";

describe("classifyPromptDispatchFailure", () => {
  it("treats pre-request failures as not sent", () => {
    expect(classifyPromptDispatchFailure(new Error("File read failed"), false))
      .toMatchObject({
        deliveryState: "failed_before_dispatch",
        message: "File read failed",
      });
  });

  it("treats definitive post-request rejections as not sent", () => {
    expect(classifyPromptDispatchFailure({ problem: { status: 409 } }, true))
      .toMatchObject({
        deliveryState: "failed_before_dispatch",
      });
  });

  it("reads nested status fields from chained errors", () => {
    expect(classifyPromptDispatchFailure({
      cause: {
        response: { status: 422 },
      },
    }, true)).toMatchObject({
      deliveryState: "failed_before_dispatch",
    });
  });

  it("treats opaque post-request failures as awaiting confirmation", () => {
    expect(classifyPromptDispatchFailure(new Error("NetworkError"), true))
      .toMatchObject({
        deliveryState: "unknown_after_dispatch",
      });
  });

  it("uses fallback copy for non-error values", () => {
    expect(classifyPromptDispatchFailure(null, false)).toMatchObject({
      message: "Prompt delivery failed.",
    });
  });
});
