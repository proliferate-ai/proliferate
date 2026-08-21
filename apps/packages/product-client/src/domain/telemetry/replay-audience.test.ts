import { describe, expect, it } from "vitest";

import {
  INTERNAL_REPLAY_EMAIL_DOMAINS,
  isInternalReplayAudience,
} from "./replay-audience";

describe("isInternalReplayAudience", () => {
  it.each(INTERNAL_REPLAY_EMAIL_DOMAINS)("admits an address at %s", (domain) => {
    expect(isInternalReplayAudience(`pablo@${domain}`)).toBe(true);
    expect(isInternalReplayAudience(`  Pablo@${domain.toUpperCase()}  `)).toBe(true);
  });

  it.each([
    ["a customer address", "someone@customer.example"],
    ["a look-alike domain", "someone@notproliferate.com"],
    ["a suffixed look-alike", "someone@proliferate.com.attacker.net"],
    ["a subdomain", "someone@mail.proliferate.com"],
    ["a domain in the local part", "proliferate.com@customer.example"],
    ["an address with no domain", "someone@"],
    ["an address with no local part", "@proliferate.com"],
    ["a bare domain", "proliferate.com"],
    ["an embedded address", "someone@customer.example someone@proliferate.com"],
    ["an empty string", ""],
    ["whitespace", "   "],
  ])("rejects %s", (_case, email) => {
    expect(isInternalReplayAudience(email)).toBe(false);
  });

  it.each([null, undefined])("rejects %p", (email) => {
    expect(isInternalReplayAudience(email)).toBe(false);
  });

  it("keeps the audience a closed source-owned list", () => {
    expect(INTERNAL_REPLAY_EMAIL_DOMAINS).toEqual(["proliferate.com", "proliferate.dev"]);
  });
});
