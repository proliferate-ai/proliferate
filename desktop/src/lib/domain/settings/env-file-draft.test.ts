import { describe, expect, it } from "vitest";
import {
  envFileVariablesEqual,
  parseEnvFileVariables,
  serializeEnvFileVariables,
} from "@/lib/domain/settings/env-file-draft";

describe("env file draft helpers", () => {
  it("parses editable key/value rows from .env-style content", () => {
    expect(parseEnvFileVariables([
      "# shared values",
      "API_BASE_URL=https://example.internal",
      "export SHARED_TOKEN=\"with spaces\"",
      "IGNORED_LINE",
      "EMPTY=",
    ].join("\n"))).toEqual([
      { key: "API_BASE_URL", value: "https://example.internal" },
      { key: "SHARED_TOKEN", value: "with spaces" },
      { key: "EMPTY", value: "" },
    ]);
  });

  it("serializes rows back to deterministic .env content", () => {
    expect(serializeEnvFileVariables([
      { key: " API_BASE_URL ", value: "https://example.internal" },
      { key: "SHARED_TOKEN", value: "with spaces" },
      { key: "", value: "ignored" },
    ])).toBe("API_BASE_URL=https://example.internal\nSHARED_TOKEN=\"with spaces\"\n");
  });

  it("compares rows by serialized content", () => {
    expect(envFileVariablesEqual(
      [{ key: "API_BASE_URL", value: "https://example.internal" }],
      [{ key: " API_BASE_URL ", value: "https://example.internal" }],
    )).toBe(true);
  });
});
