import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseEnvFileAsData } from "./env-file.js";

function withTempFile(contents: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "tf-tier2-env-file-"));
  const file = path.join(dir, "test.env");
  writeFileSync(file, contents);
  return file;
}

test("parseEnvFileAsData: parses export lines, plain lines, quotes, comments, and blanks", () => {
  const file = withTempFile(
    [
      "# a comment",
      "",
      "export FOO=bar",
      'BAZ="quoted value"',
      "SINGLE='single quoted'",
      "  # indented comment",
      "TRAILING_SPACE = has-space ",
    ].join("\n"),
  );
  const parsed = parseEnvFileAsData(file);
  assert.equal(parsed.FOO, "bar");
  assert.equal(parsed.BAZ, "quoted value");
  assert.equal(parsed.SINGLE, "single quoted");
  // Key before the first "=" is trimmed, so "TRAILING_SPACE " -> "TRAILING_SPACE".
  assert.equal(parsed.TRAILING_SPACE, "has-space");
  assert.equal(Object.keys(parsed).length, 4);
});

test("parseEnvFileAsData: a nonexistent file parses to an empty object, never throws", () => {
  assert.deepEqual(parseEnvFileAsData("/definitely/not/a/real/path.env"), {});
});

test("parseEnvFileAsData: never executes the file as shell (no command substitution/expansion)", () => {
  const file = withTempFile('DANGEROUS=$(echo pwned)\nBACKTICK=`echo pwned`\n');
  const parsed = parseEnvFileAsData(file);
  // Parsed as a literal string, not expanded/executed.
  assert.equal(parsed.DANGEROUS, "$(echo pwned)");
  assert.equal(parsed.BACKTICK, "`echo pwned`");
});
