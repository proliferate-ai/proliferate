import { describe, expect, it } from "vitest";
import { ProliferateClientError } from "@proliferate/cloud-sdk";
import {
  STALE_MATERIALIZATION_GENERATION_CODE,
  isStaleMaterializationGenerationError,
} from "#product/lib/domain/workspaces/cloud/materialization-report-error";

describe("isStaleMaterializationGenerationError", () => {
  it("detects the server's 409 stale-generation code (PR 4 report rejection)", () => {
    const error = new ProliferateClientError(
      "This materialization report is stale.",
      409,
      STALE_MATERIALIZATION_GENERATION_CODE,
    );
    expect(isStaleMaterializationGenerationError(error)).toBe(true);
  });

  it("does not match a different 409 code or a non-409 status", () => {
    expect(
      isStaleMaterializationGenerationError(
        new ProliferateClientError("mismatch", 409, "materialization_sha_mismatch"),
      ),
    ).toBe(false);
    expect(
      isStaleMaterializationGenerationError(
        new ProliferateClientError("stale", 500, STALE_MATERIALIZATION_GENERATION_CODE),
      ),
    ).toBe(false);
  });

  it("does not match a plain Error", () => {
    expect(isStaleMaterializationGenerationError(new Error("boom"))).toBe(false);
    expect(isStaleMaterializationGenerationError(null)).toBe(false);
  });
});
