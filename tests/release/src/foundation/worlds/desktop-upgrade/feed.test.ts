import assert from "node:assert/strict";
import { test } from "node:test";

import {
  parseUpdaterFeed,
  compareVersions,
  isNewerVersion,
  IsolatedUpdaterFeed,
  FeedParseError,
} from "./feed.js";

const VALID = {
  version: "0.3.26",
  pub_date: "2026-07-12T10:35:53.937Z",
  platforms: {
    "darwin-aarch64": { signature: "sig-a", url: "https://example/x.app.tar.gz" },
  },
};

test("parseUpdaterFeed accepts a well-formed manifest", () => {
  const feed = parseUpdaterFeed(VALID);
  assert.equal(feed.version, "0.3.26");
  assert.equal(feed.platforms["darwin-aarch64"].signature, "sig-a");
});

test("parseUpdaterFeed rejects malformed manifests rather than tolerating them", () => {
  assert.throws(() => parseUpdaterFeed(null), FeedParseError);
  assert.throws(() => parseUpdaterFeed({ version: "", pub_date: "x", platforms: {} }), FeedParseError);
  assert.throws(() => parseUpdaterFeed({ version: "1.0.0", platforms: {} }), FeedParseError);
  assert.throws(
    () => parseUpdaterFeed({ version: "1.0.0", pub_date: "x", platforms: { p: { url: "u" } } }),
    FeedParseError,
  );
  assert.throws(
    () => parseUpdaterFeed({ version: "1.0.0", pub_date: "x", platforms: {} }),
    FeedParseError,
  );
});

test("parseUpdaterFeed enforces requested-version match (versioned-record rejection)", () => {
  assert.doesNotThrow(() => parseUpdaterFeed(VALID, { expectVersion: "0.3.26" }));
  assert.throws(() => parseUpdaterFeed(VALID, { expectVersion: "0.3.27" }), FeedParseError);
});

test("compareVersions / isNewerVersion order the x.y.z line", () => {
  assert.equal(compareVersions("0.3.26", "0.3.25"), 1);
  assert.equal(compareVersions("0.3.25", "0.3.26"), -1);
  assert.equal(compareVersions("0.3.26", "0.3.26"), 0);
  assert.equal(isNewerVersion("0.3.27", "0.3.26"), true);
  assert.equal(isNewerVersion("0.3.26", "0.3.26"), false);
  assert.equal(isNewerVersion("0.3.25", "0.3.26"), false);
});

test("IsolatedUpdaterFeed initially advertises exactly N-1 (no update)", async () => {
  const feed = new IsolatedUpdaterFeed("0.3.26");
  try {
    await feed.start();
    assert.equal(feed.advertisedVersion(), "0.3.26");
    const probe = await feed.probe();
    assert.equal(probe.ok, true);
    const res = await fetch(feed.feedUrl());
    const body = await res.json();
    // No platforms staged initially -> check() would see nothing newer than N-1.
    assert.equal(body.version, "0.3.26");
    assert.deepEqual(body.platforms, {});
  } finally {
    await feed.close();
  }
});

test("advertiseCandidate refuses a version not strictly newer than N-1", async () => {
  const feed = new IsolatedUpdaterFeed("0.3.26");
  try {
    await feed.start();
    assert.throws(
      () =>
        feed.advertiseCandidate("0.3.26", "/tmp", [
          { platform: "darwin-aarch64", tarballPath: "/tmp/x.app.tar.gz", signaturePath: "/tmp/x.app.tar.gz.sig" },
        ]),
      /not newer than N-1/,
    );
  } finally {
    await feed.close();
  }
});

test("advertiseCandidate requires the staged files to exist on disk", async () => {
  const feed = new IsolatedUpdaterFeed("0.3.26");
  try {
    await feed.start();
    assert.throws(
      () =>
        feed.advertiseCandidate("0.3.27", "/tmp/nope", [
          { platform: "darwin-aarch64", tarballPath: "/tmp/nope/x.app.tar.gz", signaturePath: "/tmp/nope/x.sig" },
        ]),
      /staged tarball missing/,
    );
  } finally {
    await feed.close();
  }
});
