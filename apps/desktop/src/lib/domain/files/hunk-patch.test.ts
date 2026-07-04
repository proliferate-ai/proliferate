import { describe, expect, it } from "vitest";
import { extractHunkPatch, isHunkActionEligible } from "./hunk-patch";

describe("isHunkActionEligible", () => {
  it("returns true for a normal edit patch", () => {
    const patch = `diff --git a/foo.ts b/foo.ts
--- a/foo.ts
+++ b/foo.ts
@@ -1,3 +1,4 @@
 line1
+added
 line2
 line3
`;
    expect(isHunkActionEligible(patch)).toBe(true);
  });

  it("returns false for empty patch", () => {
    expect(isHunkActionEligible("")).toBe(false);
    expect(isHunkActionEligible("   ")).toBe(false);
  });

  it("returns false for binary patches", () => {
    expect(isHunkActionEligible("GIT binary patch\nsome data")).toBe(false);
    expect(isHunkActionEligible("Binary files a/img.png and b/img.png differ")).toBe(false);
  });

  it("returns false for rename/copy", () => {
    expect(isHunkActionEligible("rename from old.ts\nrename to new.ts")).toBe(false);
    expect(isHunkActionEligible("copy from src.ts\ncopy to dst.ts")).toBe(false);
  });

  it("returns false when oldPath is provided (indicates rename)", () => {
    expect(isHunkActionEligible("@@ -1,3 +1,4 @@\n line\n+add\n line", "old.ts")).toBe(false);
  });
});

describe("extractHunkPatch", () => {
  const MULTI_HUNK_PATCH = `diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,5 +1,6 @@
 import { foo } from "bar";
+import { baz } from "qux";

 function main() {
   foo();
@@ -10,4 +11,5 @@
 }

 function helper() {
+  console.log("debug");
   return 42;
`;

  it("extracts the first hunk with file headers", () => {
    const result = extractHunkPatch({
      patch: MULTI_HUNK_PATCH,
      hunkIndex: 0,
      filePath: "src/app.ts",
    });
    expect(result).not.toBeNull();
    expect(result!.patch).toContain("diff --git a/src/app.ts b/src/app.ts");
    expect(result!.patch).toContain("--- a/src/app.ts");
    expect(result!.patch).toContain("+++ b/src/app.ts");
    expect(result!.patch).toContain('@@ -1,5 +1,6 @@');
    expect(result!.patch).toContain('+import { baz } from "qux";');
    // Should NOT contain the second hunk
    expect(result!.patch).not.toContain("@@ -10,4 +11,5 @@");
    expect(result!.patch).not.toContain("console.log");
  });

  it("extracts the second hunk with file headers", () => {
    const result = extractHunkPatch({
      patch: MULTI_HUNK_PATCH,
      hunkIndex: 1,
      filePath: "src/app.ts",
    });
    expect(result).not.toBeNull();
    expect(result!.patch).toContain("diff --git a/src/app.ts b/src/app.ts");
    expect(result!.patch).toContain("@@ -10,4 +11,5 @@");
    expect(result!.patch).toContain('+  console.log("debug");');
    // Should NOT contain the first hunk
    expect(result!.patch).not.toContain("@@ -1,5 +1,6 @@");
  });

  it("returns null for out-of-range hunk index", () => {
    expect(extractHunkPatch({
      patch: MULTI_HUNK_PATCH,
      hunkIndex: 5,
      filePath: "src/app.ts",
    })).toBeNull();

    expect(extractHunkPatch({
      patch: MULTI_HUNK_PATCH,
      hunkIndex: -1,
      filePath: "src/app.ts",
    })).toBeNull();
  });

  it("returns null for binary patch", () => {
    expect(extractHunkPatch({
      patch: "GIT binary patch\ndata",
      hunkIndex: 0,
      filePath: "img.png",
    })).toBeNull();
  });

  it("returns null when oldPath indicates rename", () => {
    expect(extractHunkPatch({
      patch: MULTI_HUNK_PATCH,
      hunkIndex: 0,
      filePath: "src/app.ts",
      oldPath: "src/old-app.ts",
    })).toBeNull();
  });

  it("handles new file patch", () => {
    const newFilePatch = `diff --git a/new.ts b/new.ts
new file mode 100644
--- /dev/null
+++ b/new.ts
@@ -0,0 +1,3 @@
+line1
+line2
+line3
`;
    const result = extractHunkPatch({
      patch: newFilePatch,
      hunkIndex: 0,
      filePath: "new.ts",
    });
    expect(result).not.toBeNull();
    expect(result!.patch).toContain("new file mode 100644");
    expect(result!.patch).toContain("--- /dev/null");
    expect(result!.patch).toContain("+++ b/new.ts");
    expect(result!.patch).toContain("+line1");
  });

  it("handles deleted file patch", () => {
    const deletedPatch = `diff --git a/old.ts b/old.ts
deleted file mode 100644
--- a/old.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-line1
-line2
-line3
`;
    const result = extractHunkPatch({
      patch: deletedPatch,
      hunkIndex: 0,
      filePath: "old.ts",
    });
    expect(result).not.toBeNull();
    expect(result!.patch).toContain("deleted file mode 100644");
    expect(result!.patch).toContain("--- a/old.ts");
    expect(result!.patch).toContain("+++ /dev/null");
    expect(result!.patch).toContain("-line1");
  });

  it("preserves 'No newline at end of file' marker", () => {
    const patch = `diff --git a/foo.ts b/foo.ts
--- a/foo.ts
+++ b/foo.ts
@@ -1,3 +1,3 @@
 line1
-line2
+line2modified
\\ No newline at end of file
`;
    const result = extractHunkPatch({
      patch,
      hunkIndex: 0,
      filePath: "foo.ts",
    });
    expect(result).not.toBeNull();
    expect(result!.patch).toContain("\\ No newline at end of file");
  });

  it("generates file headers when patch has none (bare hunk)", () => {
    const bareHunk = `@@ -5,3 +5,4 @@
 context
+addition
 more context
 end
`;
    const result = extractHunkPatch({
      patch: bareHunk,
      hunkIndex: 0,
      filePath: "src/utils.ts",
    });
    expect(result).not.toBeNull();
    expect(result!.patch).toContain("diff --git a/src/utils.ts b/src/utils.ts");
    expect(result!.patch).toContain("--- a/src/utils.ts");
    expect(result!.patch).toContain("+++ b/src/utils.ts");
    expect(result!.patch).toContain("@@ -5,3 +5,4 @@");
  });

  it("always ends with a newline", () => {
    const patch = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,2 +1,3 @@
 line1
+inserted
 line2`;
    const result = extractHunkPatch({
      patch,
      hunkIndex: 0,
      filePath: "a.ts",
    });
    expect(result).not.toBeNull();
    expect(result!.patch.endsWith("\n")).toBe(true);
  });
});
