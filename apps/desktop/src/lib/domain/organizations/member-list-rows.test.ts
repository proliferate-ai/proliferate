import { describe, expect, it } from "vitest";

import { invitationDeliveryHint } from "./member-list-rows";

describe("invitationDeliveryHint", () => {
  it("prompts the copy-link fallback when email was not delivered", () => {
    // The self-hosted posture (no RESEND_API_KEY) leaves delivery `skipped`;
    // the admin needs to know to copy the link instead of waiting for an email.
    expect(invitationDeliveryHint("skipped")).toMatch(/copy the invite link/i);
    expect(invitationDeliveryHint("failed")).toMatch(/copy the invite link/i);
  });

  it("shows no hint once the email was sent or is still pending", () => {
    expect(invitationDeliveryHint("sent")).toBeNull();
    expect(invitationDeliveryHint("pending")).toBeNull();
    expect(invitationDeliveryHint("")).toBeNull();
    expect(invitationDeliveryHint("something-unexpected")).toBeNull();
  });
});
