// Per-session, per-bucket measured-height calibration (Chat Scroll rung 5,
// PRO-187). The composition estimate (transcript-row-height-estimate.ts) buckets
// a row's up-front guess from its shape, but a static per-bucket constant cannot
// know how tall the prose in THIS session's turns actually runs: a bucket tuned
// against short turns undershoots a session full of long ones, and vice versa.
//
// This store closes that gap without threading content through the measurement
// model. Every real measurement the virtualizer takes is folded into a running
// average for the row's composition bucket (see getRowEstimateBucketKey). An
// unmeasured row then borrows its bucket's running average instead of the static
// default, so once a handful of rows in a bucket have been measured for real,
// every never-measured row of the same shape is estimated from this session's
// own observed heights. A row that has itself been measured always uses its
// exact persisted height (transcript-row-height-cache.ts); calibration only ever
// supplies the guess for rows this session has never measured.
//
// This is NOT a persisted or cross-session contract: module-level state only,
// same house pattern as transcript-row-height-cache.ts, and it never survives a
// reload or leaks between sessions (keyed by the same sessionKey).
interface BucketAverage {
  count: number;
  sum: number;
}

const bucketAveragesBySession = new Map<string, Map<string, BucketAverage>>();

// A per-session generation counter that bumps ONLY when a bucket takes its very
// first measurement (a 0 -> 1 sample transition), never on subsequent samples.
// The measurement model folds this into estimateSize's identity so TanStack
// re-derives the still-estimated off-screen rows once a bucket first has real
// data to borrow — TanStack caches each row's estimate on first pass and would
// otherwise keep serving the pre-calibration static guess for rows that never
// scroll into view. Gating on first-sample-per-bucket bounds the rotations to
// the handful of distinct composition buckets a session ever shows (a streaming
// turn's bucket bumps at most once, on its first real measurement, then stays
// fixed across every later chunk), so this cannot reopen the streaming
// accessor-churn follow-lag the stable-identity contract guards against.
const calibrationGenerationBySession = new Map<string, number>();

// Cap the number of samples that move a bucket's average so one very long
// session cannot let ancient rows dominate later ones; past the cap the running
// mean tracks recent measurements with exponential-ish decay via a capped count.
const MAX_BUCKET_SAMPLES = 64;

export function recordBucketMeasurement(
  sessionKey: string,
  bucketKey: string | null,
  px: number,
): void {
  if (bucketKey === null || !Number.isFinite(px) || px <= 0) {
    return;
  }
  let sessionMap = bucketAveragesBySession.get(sessionKey);
  if (!sessionMap) {
    sessionMap = new Map();
    bucketAveragesBySession.set(sessionKey, sessionMap);
  }
  const existing = sessionMap.get(bucketKey);
  if (!existing) {
    sessionMap.set(bucketKey, { count: 1, sum: px });
    calibrationGenerationBySession.set(
      sessionKey,
      (calibrationGenerationBySession.get(sessionKey) ?? 0) + 1,
    );
    return;
  }
  if (existing.count >= MAX_BUCKET_SAMPLES) {
    // Hold the sample weight at the cap: drop the mean's oldest weight by one
    // sample's worth and fold the new measurement in, so the average keeps
    // tracking without unbounded accumulation.
    const mean = existing.sum / existing.count;
    existing.sum = existing.sum - mean + px;
    return;
  }
  existing.count += 1;
  existing.sum += px;
}

export function getCalibratedBucketHeight(
  sessionKey: string,
  bucketKey: string | null,
): number | null {
  if (bucketKey === null) {
    return null;
  }
  const sessionMap = bucketAveragesBySession.get(sessionKey);
  if (!sessionMap) {
    return null;
  }
  const entry = sessionMap.get(bucketKey);
  if (!entry || entry.count <= 0) {
    return null;
  }
  return Math.round(entry.sum / entry.count);
}

// Monotonic per-session generation, bumped only on a bucket's first sample.
// Consumers fold it into a memo/accessor identity so a first-time bucket
// calibration forces a re-derivation of still-estimated rows.
export function getCalibrationGeneration(sessionKey: string): number {
  return calibrationGenerationBySession.get(sessionKey) ?? 0;
}

export function clearRowHeightCalibrationForTests(): void {
  bucketAveragesBySession.clear();
  calibrationGenerationBySession.clear();
}
