use std::fmt;

use proliferate_diagnostics_protocol::v1::limits::{
    MAX_BATCH_BYTES, MAX_BATCH_RECORDS, MAX_RECORD_BYTES,
};
use proliferate_diagnostics_protocol::v1::types::RejectionReasonV1;
use proliferate_diagnostics_protocol::v1::validation::{
    parse_ingest_batch_value, parse_producer_record_value,
};
use serde::de::{DeserializeSeed, MapAccess, SeqAccess, Visitor};
use serde::{Deserialize, Deserializer};
use serde_json::value::RawValue;

use crate::state::{IngestCandidate, PreparedRecord};

const BATCH_RECORD_LIMIT_MARKER: &str = "collector_batch_record_limit";
const BATCH_NODE_LIMIT_MARKER: &str = "collector_batch_node_limit";
const RECORD_NODE_LIMIT_MARKER: &str = "collector_record_node_limit";

// A compact JSON array needs at least two bytes for every scalar after the
// first (comma plus value). Counting the root too makes this a conservative
// upper bound for every record whose compact encoding can fit in 65,536 bytes.
pub(crate) const MAX_RECORD_PARSE_NODES: usize = MAX_RECORD_BYTES / 2 + 1;
const MAX_BATCH_PARSE_NODES: usize = MAX_BATCH_BYTES / 2 + 1;
pub(crate) const MAX_PREPARED_BATCH_BYTES: usize = MAX_BATCH_BYTES;

pub(crate) struct ParsedIngestBatch {
    pub(crate) candidates: Vec<IngestCandidate>,
    pub(crate) prepared_bytes: usize,
    pub(crate) raw_record_count: usize,
}

#[derive(Deserialize)]
struct BorrowedIngestBatch<'a> {
    #[serde(borrow)]
    schema_version: &'a RawValue,
    #[serde(borrow, deserialize_with = "deserialize_bounded_records")]
    records: Vec<&'a RawValue>,
}

fn deserialize_bounded_records<'de, D>(deserializer: D) -> Result<Vec<&'de RawValue>, D::Error>
where
    D: Deserializer<'de>,
{
    deserializer.deserialize_seq(BoundedRawRecordsVisitor)
}

struct BoundedRawRecordsVisitor;

impl<'de> Visitor<'de> for BoundedRawRecordsVisitor {
    type Value = Vec<&'de RawValue>;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a bounded diagnostics record array")
    }

    fn visit_seq<A>(self, mut sequence: A) -> Result<Self::Value, A::Error>
    where
        A: SeqAccess<'de>,
    {
        let mut records = Vec::with_capacity(MAX_BATCH_RECORDS);
        while let Some(record) = sequence.next_element::<&'de RawValue>()? {
            if records.len() == MAX_BATCH_RECORDS {
                return Err(serde::de::Error::custom(BATCH_RECORD_LIMIT_MARKER));
            }
            records.push(record);
        }
        Ok(records)
    }
}

pub(crate) fn parse_ingest_body(body: &[u8]) -> Result<ParsedIngestBatch, RejectionReasonV1> {
    // Decode every string, including ignored fields, so raw-wire lone
    // surrogates retain RV-06 behavior. This pass retains no JSON tree, and
    // its node bound is conservative for every body within MAX_BATCH_BYTES.
    enforce_json_node_budget(body, MAX_BATCH_PARSE_NODES, BATCH_NODE_LIMIT_MARKER)
        .map_err(|_| RejectionReasonV1::InvalidShape)?;

    let mut deserializer = serde_json::Deserializer::from_slice(body);
    let batch = BorrowedIngestBatch::deserialize(&mut deserializer).map_err(|error| {
        if error.to_string().contains(BATCH_RECORD_LIMIT_MARKER) {
            RejectionReasonV1::BatchTooLarge
        } else {
            RejectionReasonV1::InvalidShape
        }
    })?;
    deserializer
        .end()
        .map_err(|_| RejectionReasonV1::InvalidShape)?;

    // Reuse the frozen raw envelope parser on the small schema-only shape.
    // The body byte cap and bounded sequence visitor already established the
    // two limits that would otherwise require materializing the record array.
    let schema_version = serde_json::from_str::<serde_json::Value>(batch.schema_version.get())
        .map_err(|_| RejectionReasonV1::InvalidShape)?;
    let envelope = serde_json::json!({
        "schema_version": schema_version,
        "records": [],
    });
    parse_ingest_batch_value(&envelope)?;

    let raw_record_count = batch.records.len();
    let mut prepared_bytes = 0_usize;
    let mut candidates = Vec::with_capacity(raw_record_count);
    for (index, raw) in batch.records.into_iter().enumerate() {
        let parsed = prepare_record(raw);
        if let Ok(prepared) = &parsed {
            prepared_bytes = prepared_bytes
                .checked_add(prepared.encoded.len())
                .ok_or(RejectionReasonV1::BatchTooLarge)?;
            if prepared_bytes > MAX_PREPARED_BATCH_BYTES {
                return Err(RejectionReasonV1::BatchTooLarge);
            }
        }
        candidates.push(IngestCandidate {
            index: index as u16,
            parsed,
        });
    }

    Ok(ParsedIngestBatch {
        candidates,
        prepared_bytes,
        raw_record_count,
    })
}

fn prepare_record(raw: &RawValue) -> Result<PreparedRecord, RejectionReasonV1> {
    enforce_record_node_budget(raw)?;
    let value = serde_json::from_str(raw.get()).map_err(|_| RejectionReasonV1::InvalidShape)?;
    let record = parse_producer_record_value(&value)?;
    let encoded = serde_json::to_vec(&record).map_err(|_| RejectionReasonV1::InvalidShape)?;
    if encoded.len() > MAX_RECORD_BYTES {
        return Err(RejectionReasonV1::RecordTooLarge);
    }
    Ok(PreparedRecord {
        component: record.component,
        producer_boot_id: record.producer_boot_id.clone(),
        schema_version: record.schema_version,
        encoded: encoded.into_boxed_slice(),
    })
}

fn enforce_record_node_budget(raw: &RawValue) -> Result<(), RejectionReasonV1> {
    enforce_json_node_budget(
        raw.get().as_bytes(),
        MAX_RECORD_PARSE_NODES,
        RECORD_NODE_LIMIT_MARKER,
    )
    .map_err(|error| {
        if error.to_string().contains(RECORD_NODE_LIMIT_MARKER) {
            RejectionReasonV1::RecordTooLarge
        } else {
            RejectionReasonV1::InvalidShape
        }
    })
}

fn enforce_json_node_budget(
    json: &[u8],
    limit: usize,
    limit_marker: &'static str,
) -> Result<(), serde_json::Error> {
    let mut nodes = 0_usize;
    let mut deserializer = serde_json::Deserializer::from_slice(json);
    JsonNodeSeed {
        nodes: &mut nodes,
        limit,
        limit_marker,
    }
    .deserialize(&mut deserializer)?;
    deserializer.end()
}

struct JsonNodeSeed<'a> {
    nodes: &'a mut usize,
    limit: usize,
    limit_marker: &'static str,
}

impl<'de> DeserializeSeed<'de> for JsonNodeSeed<'_> {
    type Value = ();

    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: Deserializer<'de>,
    {
        if *self.nodes == self.limit {
            return Err(serde::de::Error::custom(self.limit_marker));
        }
        *self.nodes += 1;
        deserializer.deserialize_any(JsonNodeVisitor {
            nodes: self.nodes,
            limit: self.limit,
            limit_marker: self.limit_marker,
        })
    }
}

struct JsonNodeVisitor<'a> {
    nodes: &'a mut usize,
    limit: usize,
    limit_marker: &'static str,
}

impl<'de> Visitor<'de> for JsonNodeVisitor<'_> {
    type Value = ();

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a JSON value within the configured node budget")
    }

    fn visit_bool<E>(self, _value: bool) -> Result<Self::Value, E> {
        Ok(())
    }

    fn visit_i64<E>(self, _value: i64) -> Result<Self::Value, E> {
        Ok(())
    }

    fn visit_u64<E>(self, _value: u64) -> Result<Self::Value, E> {
        Ok(())
    }

    fn visit_f64<E>(self, _value: f64) -> Result<Self::Value, E> {
        Ok(())
    }

    fn visit_str<E>(self, _value: &str) -> Result<Self::Value, E> {
        Ok(())
    }

    fn visit_borrowed_str<E>(self, _value: &'de str) -> Result<Self::Value, E> {
        Ok(())
    }

    fn visit_string<E>(self, _value: String) -> Result<Self::Value, E> {
        Ok(())
    }

    fn visit_unit<E>(self) -> Result<Self::Value, E> {
        Ok(())
    }

    fn visit_none<E>(self) -> Result<Self::Value, E> {
        Ok(())
    }

    fn visit_seq<A>(self, mut sequence: A) -> Result<Self::Value, A::Error>
    where
        A: SeqAccess<'de>,
    {
        while sequence
            .next_element_seed(JsonNodeSeed {
                nodes: &mut *self.nodes,
                limit: self.limit,
                limit_marker: self.limit_marker,
            })?
            .is_some()
        {}
        Ok(())
    }

    fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
    where
        A: MapAccess<'de>,
    {
        while map.next_key_seed(JsonStringSeed)?.is_some() {
            map.next_value_seed(JsonNodeSeed {
                nodes: &mut *self.nodes,
                limit: self.limit,
                limit_marker: self.limit_marker,
            })?;
        }
        Ok(())
    }
}

struct JsonStringSeed;

impl<'de> DeserializeSeed<'de> for JsonStringSeed {
    type Value = ();

    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_str(JsonStringVisitor)
    }
}

struct JsonStringVisitor;

impl<'de> Visitor<'de> for JsonStringVisitor {
    type Value = ();

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a valid JSON string")
    }

    fn visit_str<E>(self, _value: &str) -> Result<Self::Value, E> {
        Ok(())
    }

    fn visit_borrowed_str<E>(self, _value: &'de str) -> Result<Self::Value, E> {
        Ok(())
    }

    fn visit_string<E>(self, _value: String) -> Result<Self::Value, E> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn degenerate_array_batch(single_record: bool) -> Vec<u8> {
        let prefix = if single_record {
            br#"{"schema_version":{"major":1,"minor":1},"records":[["#.as_slice()
        } else {
            br#"{"schema_version":{"major":1,"minor":1},"records":["#.as_slice()
        };
        let suffix: &[u8] = if single_record { b"]]}" } else { b"]}" };
        let mut body = Vec::with_capacity(MAX_BATCH_BYTES);
        body.extend_from_slice(prefix);
        while body.len() + suffix.len() + 2 <= MAX_BATCH_BYTES {
            body.extend_from_slice(b"0,");
        }
        if body.last() == Some(&b',') {
            body.pop();
        }
        body.extend_from_slice(suffix);
        body
    }

    #[test]
    fn outer_degenerate_batch_stops_at_the_frozen_record_count_before_value_materialization() {
        let body = degenerate_array_batch(false);
        assert!(body.len() <= MAX_BATCH_BYTES);
        assert!(body.iter().filter(|byte| **byte == b',').count() > MAX_RECORD_PARSE_NODES);
        assert!(matches!(
            parse_ingest_body(&body),
            Err(RejectionReasonV1::BatchTooLarge)
        ));
    }

    #[test]
    fn single_degenerate_record_stops_at_the_node_budget_before_value_materialization() {
        let body = degenerate_array_batch(true);
        assert!(body.len() <= MAX_BATCH_BYTES);
        let parsed = parse_ingest_body(&body).expect("admissible one-record envelope");
        assert_eq!(parsed.raw_record_count, 1);
        assert_eq!(parsed.prepared_bytes, 0);
        assert!(matches!(
            parsed.candidates[0].parsed,
            Err(RejectionReasonV1::RecordTooLarge)
        ));
    }

    #[test]
    fn streaming_wire_validation_decodes_ignored_strings() {
        let body = br#"{"schema_version":{"major":1,"minor":1},"records":[],"ignored":"\ud800"}"#;
        assert!(matches!(
            parse_ingest_body(body),
            Err(RejectionReasonV1::InvalidShape)
        ));
    }

    #[test]
    fn maximum_record_count_retains_only_borrowed_slices_and_bounded_encodings() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../fixtures/contracts/rust-observability-v1/valid/records.json"
        )))
        .expect("valid records fixture");
        let record = fixture["records"][0].clone();
        let body = serde_json::to_vec(&serde_json::json!({
            "schema_version": {"major": 1, "minor": 1},
            "records": vec![record; MAX_BATCH_RECORDS],
        }))
        .expect("maximum-count body");
        assert!(body.len() <= MAX_BATCH_BYTES);

        let parsed = parse_ingest_body(&body).expect("maximum-count batch");
        assert_eq!(parsed.raw_record_count, MAX_BATCH_RECORDS);
        assert!(parsed.prepared_bytes <= MAX_PREPARED_BATCH_BYTES);
        assert!(parsed
            .candidates
            .iter()
            .all(|candidate| candidate.parsed.is_ok()));
    }
}
