import assert from "node:assert/strict";
import test from "node:test";

import {
  buildResult,
  parseSurfaceList,
  selectSurfaces,
} from "./detect-deploy-surfaces.mjs";

test("selects detected surfaces when no override is provided", () => {
  const selection = selectSurfaces({
    files: ["server/proliferate/app.py", "apps/web/src/main.tsx"],
  });

  assert.equal(selection.selectionMode, "detected");
  assert.deepEqual([...selection.selected].sort(), ["server", "web"]);
});

test("force surfaces are additive", () => {
  const result = buildResult({
    baseSha: "base",
    headSha: "head",
    files: ["server/proliferate/app.py"],
    force: "desktop",
    only: "",
  });

  assert.equal(result.selectionMode, "detected");
  assert.equal(result.surfaces.server, true);
  assert.equal(result.surfaces.desktop, true);
  assert.equal(result.surfaces.web, false);
  assert.deepEqual(result.forcedSurfaces, ["desktop"]);
});

test("only surfaces replace detected surfaces", () => {
  const result = buildResult({
    baseSha: "base",
    headSha: "head",
    files: ["server/proliferate/app.py", "apps/web/src/main.tsx"],
    force: "desktop",
    only: "web",
  });

  assert.equal(result.selectionMode, "only");
  assert.equal(result.surfaces.web, true);
  assert.equal(result.surfaces.server, false);
  assert.equal(result.surfaces.desktop, false);
  assert.deepEqual(result.onlySurfaces, ["web"]);
});

test("all expands to every known surface", () => {
  assert.deepEqual([...parseSurfaceList("all", "only")].sort(), [
    "desktop",
    "e2b",
    "mobile",
    "runtime",
    "server",
    "web",
    "workers",
  ]);
});

test("invalid surfaces fail fast", () => {
  assert.throws(
    () => parseSurfaceList("web,billing", "only"),
    /Unknown only deploy surface\(s\): billing/,
  );
});
