#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RssWarmupV1 {
    pub duration_seconds: u32,
    pub records: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RssConcurrencyV1 {
    pub ingest_writers: u16,
    pub query_readers: u16,
    pub tail_readers: u16,
    pub export_readers: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RssStressV1 {
    pub duration_seconds: u32,
    pub records_per_second: u32,
    pub oversized_record_every: u32,
    pub slow_tail_delay_ms: u32,
    pub fail_exporter_after_records: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RssSamplingV1 {
    pub interval_ms: u32,
    pub command_template: String,
    pub samples_output: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RssPassFailV1 {
    pub total_rss_limit_bytes: u64,
    pub retained_arena_limit_bytes: u64,
    pub required_conditions: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RssMeasurementProfileV1 {
    pub schema_version: SchemaVersionV1,
    pub targets: Vec<String>,
    pub build_profile: String,
    pub warmup: RssWarmupV1,
    pub concurrency: RssConcurrencyV1,
    pub stress: RssStressV1,
    pub sampling: RssSamplingV1,
    pub pass_fail: RssPassFailV1,
    pub steps: Vec<String>,
}
