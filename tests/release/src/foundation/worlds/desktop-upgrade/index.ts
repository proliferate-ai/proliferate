/**
 * Desktop-upgrade world (T4-DESKTOP-1) — public surface.
 *
 * Owns: tests/release/src/foundation/worlds/desktop-upgrade/. Implements the
 * frozen WorldProvisioner / DesktopUpgradeWorldHandle contract; imports
 * contracts/** read-only. See specs/developing/testing/tier-4-scenario-contract.md.
 */

export {
  DesktopUpgradeWorldProvisioner,
  type DesktopUpgradeControls,
  type DesktopUpgradeProvisionerConfig,
  type TrustChain,
} from "./provisioner.js";
export {
  IsolatedUpdaterFeed,
  parseUpdaterFeed,
  compareVersions,
  isNewerVersion,
  ALL_FEED_PLATFORMS,
  FeedParseError,
  type UpdaterFeed,
  type FeedPlatformEntry,
  type FeedPlatformKey,
  type StagedArtifact,
} from "./feed.js";
export {
  buildRetainedManifest,
  retainedManifestHash,
  parsePubkeyFingerprint,
  verifyArtifactDigest,
  retainedPlatformForHost,
  DigestMismatchError,
  type ProductionFeedSnapshot,
  type CapturedArtifact,
  type BuildRetainedManifestOptions,
} from "./retained-manifest.js";
export { captureProductionFeed, PRODUCTION_STABLE_FEED_URL } from "./production-feed.js";
export {
  createIsolatedHome,
  removeIsolatedHome,
  installDisposableCopy,
  readBundleVersion,
  appBundleContentDigest,
  bundleHasMainBinary,
  assertNotRealLibrary,
  type IsolatedDesktopHome,
} from "./install.js";
export {
  evaluateReconcile,
  assertIdempotentReconcile,
  evaluateTranscriptContinuity,
  withDeadline,
  DeadlineExceededError,
  type PerAgentReconcileOutcome,
  type ReconcileVerdict,
  type TranscriptEvent,
} from "./reconcile.js";
export {
  runDesktopUpgradeSlice,
  type DesktopUpgradeSliceInput,
  type CandidateArtifactInput,
  type SliceReport,
  type SliceStep,
} from "./scenario.js";
