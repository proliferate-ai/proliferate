import { describe, expect, it } from "vitest";
import {
  envFileVariablesEqual,
  parseEnvFileVariables,
  serializeEnvFileVariables,
  serializeEnvFileVariablesPreservingOriginal,
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

  it("preserves original content when editable rows have not changed", () => {
    const originalContent = [
      "# keep this comment",
      "export API_BASE_URL='https://example.internal'",
      "UNSUPPORTED_LINE",
      "",
    ].join("\n");
    const originalRows = parseEnvFileVariables(originalContent);

    expect(serializeEnvFileVariablesPreservingOriginal(
      [{ key: "API_BASE_URL", value: "https://example.internal" }],
      originalRows,
      originalContent,
    )).toBe(originalContent);
  });

  it("serializes deterministic content once editable rows change", () => {
    const originalContent = "# keep this comment\nAPI_BASE_URL=https://example.internal\n";
    const originalRows = parseEnvFileVariables(originalContent);

    expect(serializeEnvFileVariablesPreservingOriginal(
      [{ key: "API_BASE_URL", value: "https://example.test" }],
      originalRows,
      originalContent,
    )).toBe("API_BASE_URL=https://example.test\n");
  });
});
