import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const UPSTREAM_REPOSITORY = "ghcr.io/berriai/litellm";
const IMMUTABLE_UPSTREAM_IMAGE =
  /^ghcr\.io\/berriai\/litellm:v\d+\.\d+\.\d+@sha256:[a-f0-9]{64}$/;
const EXPECTED_IMAGE =
  `${UPSTREAM_REPOSITORY}:v1.93.0@sha256:` +
  "a1745e629abfb17d434426ff48b115f54f4f4c4a0f5af241de569e93c63c411e";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function assertReviewedImmutableImage(image) {
  assert.match(
    image,
    IMMUTABLE_UPSTREAM_IMAGE,
    "LiteLLM must use an official version tag plus an immutable OCI digest",
  );
  assert.equal(image, EXPECTED_IMAGE, "LiteLLM upstream release/digest changed without review");
}

function upstreamImages(contents) {
  return [...contents.matchAll(/(?:^|\s)(ghcr\.io\/berriai\/litellm:\S+)/gm)].map(
    (match) => match[1],
  );
}

test("rejects floating and tag-only LiteLLM image references", () => {
  assert.throws(
    () => assertReviewedImmutableImage(`${UPSTREAM_REPOSITORY}:main-stable`),
    /immutable OCI digest/,
  );
  assert.throws(
    () => assertReviewedImmutableImage(`${UPSTREAM_REPOSITORY}:v1.93.0`),
    /immutable OCI digest/,
  );
});

test("wrapper build and local Compose bind the reviewed LiteLLM release and digest", () => {
  const buildSurface = readFileSync(path.join(REPO_ROOT, "server/litellm/Dockerfile"), "utf8");
  const localSurface = readFileSync(path.join(REPO_ROOT, "server/docker-compose.yml"), "utf8");

  const buildImages = upstreamImages(buildSurface);
  const localImages = upstreamImages(localSurface);
  assert.deepEqual(buildImages, [EXPECTED_IMAGE]);
  assert.deepEqual(localImages, [EXPECTED_IMAGE]);
  assertReviewedImmutableImage(buildImages[0]);
  assertReviewedImmutableImage(localImages[0]);
});
