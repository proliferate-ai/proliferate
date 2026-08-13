import type {
  ExporterStateV1,
  FallbackStateV1,
  HealthResponseV1,
  HealthStatusV1,
  PressureV1,
  ProducerLivenessV1,
  RssMeasurementProfileV1,
} from "./contract";
import {
  COLLECTOR_TOTAL_RSS_LIMIT_BYTES,
  MAX_ARGUMENT_LIST_ITEMS,
  MAX_CARDINALITY_ENTRIES,
  MAX_HEALTH_PRODUCERS,
  MAX_STRING_BYTES,
  RETAINED_RECORD_ARENA_LIMIT_BYTES,
} from "./limits";
import {
  canonicalClone,
  fail,
  optionalName,
  optionalNonnegativeInteger,
  requireArray,
  requireBoundedString,
  requireEnum,
  requireId,
  requireName,
  requireNonnegativeInteger,
  requireObject,
  requirePositiveInteger,
  requireString,
} from "./validation-scalars";
import { parseSchemaVersion, validateCountMap } from "./validation-support";
import { COMPONENTS, RECORD_CLASSES, REJECTION_REASONS } from "./validation-vocabulary";

export function parseHealthResponseV1(input: unknown): HealthResponseV1 {
  const raw = requireObject(input);
  const retainedBytes = requireNonnegativeInteger(raw.retained_bytes);
  const producers = requireArray(raw.producers);
  const maps = [
    requireObject(raw.evictions_by_class),
    requireObject(raw.evictions_by_component),
    requireObject(raw.evictions_by_reason),
    requireObject(raw.rejections_by_reason),
    requireObject(raw.cardinality_counts),
  ];
  if (
    retainedBytes > RETAINED_RECORD_ARENA_LIMIT_BYTES ||
    producers.length > MAX_HEALTH_PRODUCERS ||
    maps.some((value) => Object.keys(value).length > MAX_CARDINALITY_ENTRIES)
  ) {
    fail("limit_exceeded");
  }
  validateCountMap(maps[0], RECORD_CLASSES);
  validateCountMap(maps[1], COMPONENTS);
  validateCountMap(
    maps[2],
    new Set(["evicted", "producer_sequence", "tail_lag", "collector_restart"]),
  );
  validateCountMap(maps[3], REJECTION_REASONS);
  validateCountMap(maps[4]);
  Object.keys(maps[4]).forEach(requireName);
  const exporter = requireObject(raw.exporter);
  const fallback = requireObject(raw.fallback);
  return canonicalClone({
    schema_version: parseSchemaVersion(raw.schema_version),
    status: requireEnum(
      raw.status,
      new Set<HealthStatusV1>(["starting", "ready", "degraded", "stopping"]),
    ),
    collector_boot_id: requireId(raw.collector_boot_id),
    restart_count: requireNonnegativeInteger(raw.restart_count),
    pressure: requireEnum(
      raw.pressure,
      new Set<PressureV1>(["normal", "elevated", "critical"]),
    ),
    oldest_cursor: optionalNonnegativeInteger(raw.oldest_cursor),
    newest_cursor: optionalNonnegativeInteger(raw.newest_cursor),
    retained_bytes: retainedBytes,
    evictions_by_class: maps[0],
    evictions_by_component: maps[1],
    evictions_by_reason: maps[2],
    rejections_by_reason: maps[3],
    cardinality_counts: maps[4],
    rejected_records: requireNonnegativeInteger(raw.rejected_records),
    oversized_records: requireNonnegativeInteger(raw.oversized_records),
    duplicate_terminals: requireNonnegativeInteger(raw.duplicate_terminals),
    conflicting_terminals: requireNonnegativeInteger(raw.conflicting_terminals),
    producers: producers.map((value) => {
      const producer = requireObject(value);
      return {
        component: requireEnum(producer.component, COMPONENTS),
        producer_boot_id: requireId(producer.producer_boot_id),
        schema_version: parseSchemaVersion(producer.schema_version),
        last_sequence: optionalNonnegativeInteger(producer.last_sequence),
        gap_count: requireNonnegativeInteger(producer.gap_count),
        liveness: requireEnum(
          producer.liveness,
          new Set<ProducerLivenessV1>(["attached", "alive", "dead", "incompatible"]),
        ),
      };
    }),
    tail_reader_drops: requireNonnegativeInteger(raw.tail_reader_drops),
    exporter: {
      state: requireEnum(
        exporter.state,
        new Set<ExporterStateV1>(["disabled", "ready", "degraded"]),
      ),
      dropped_records: requireNonnegativeInteger(exporter.dropped_records),
      last_error_classification: optionalName(exporter.last_error_classification),
    },
    fallback: {
      state: requireEnum(
        fallback.state,
        new Set<FallbackStateV1>(["inactive", "active", "degraded"]),
      ),
      bytes: requireNonnegativeInteger(fallback.bytes),
      dropped_records: requireNonnegativeInteger(fallback.dropped_records),
    },
  } as HealthResponseV1);
}

export function parseRssMeasurementProfileV1(input: unknown): RssMeasurementProfileV1 {
  const raw = requireObject(input);
  const warmup = requireObject(raw.warmup);
  const concurrency = requireObject(raw.concurrency);
  const stress = requireObject(raw.stress);
  const sampling = requireObject(raw.sampling);
  const passFail = requireObject(raw.pass_fail);
  const targets = requireArray(raw.targets).map(requireString);
  const requiredConditions = requireArray(passFail.required_conditions).map(requireString);
  const steps = requireArray(raw.steps).map(requireString);
  const required = [
    "warm_up",
    "concurrent_ingest",
    "concurrent_query",
    "concurrent_tail",
    "concurrent_export",
    "oversized_input",
    "slow_reader",
    "failed_exporter",
    "sample_total_rss",
    "assert_responsive",
    "assert_counters_and_gaps",
  ];
  if (
    JSON.stringify(targets) !==
      JSON.stringify(["aarch64-apple-darwin", "x86_64-apple-darwin"]) ||
    raw.build_profile !== "release" ||
    passFail.total_rss_limit_bytes !== COLLECTOR_TOTAL_RSS_LIMIT_BYTES ||
    passFail.retained_arena_limit_bytes !== RETAINED_RECORD_ARENA_LIMIT_BYTES ||
    RETAINED_RECORD_ARENA_LIMIT_BYTES >= COLLECTOR_TOTAL_RSS_LIMIT_BYTES ||
    JSON.stringify(requiredConditions) !== JSON.stringify(required) ||
    steps.length === 0 ||
    steps.length > MAX_ARGUMENT_LIST_ITEMS
  ) {
    fail("invalid_shape");
  }
  const profile: RssMeasurementProfileV1 = canonicalClone({
    schema_version: parseSchemaVersion(raw.schema_version),
    targets,
    build_profile: "release",
    warmup: {
      duration_seconds: requirePositiveInteger(warmup.duration_seconds),
      records: requirePositiveInteger(warmup.records),
    },
    concurrency: {
      ingest_writers: requirePositiveInteger(concurrency.ingest_writers),
      query_readers: requirePositiveInteger(concurrency.query_readers),
      tail_readers: requirePositiveInteger(concurrency.tail_readers),
      export_readers: requirePositiveInteger(concurrency.export_readers),
    },
    stress: {
      duration_seconds: requirePositiveInteger(stress.duration_seconds),
      records_per_second: requirePositiveInteger(stress.records_per_second),
      oversized_record_every: requirePositiveInteger(stress.oversized_record_every),
      slow_tail_delay_ms: requirePositiveInteger(stress.slow_tail_delay_ms),
      fail_exporter_after_records: requirePositiveInteger(
        stress.fail_exporter_after_records,
      ),
    },
    sampling: {
      interval_ms: requirePositiveInteger(sampling.interval_ms),
      command_template: requireBoundedString(sampling.command_template, MAX_STRING_BYTES),
      samples_output: requireBoundedString(sampling.samples_output, MAX_STRING_BYTES),
    },
    pass_fail: {
      total_rss_limit_bytes: COLLECTOR_TOTAL_RSS_LIMIT_BYTES,
      retained_arena_limit_bytes: RETAINED_RECORD_ARENA_LIMIT_BYTES,
      required_conditions: requiredConditions,
    },
    steps: steps.map((step) => requireBoundedString(step, MAX_STRING_BYTES)),
  });
  return profile;
}
