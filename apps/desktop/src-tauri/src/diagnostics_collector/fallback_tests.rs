use super::*;

fn temp_path() -> PathBuf {
    std::env::temp_dir()
        .join(format!("proliferate-fallback-{}", uuid::Uuid::new_v4()))
        .join("desktop-native.log")
}

#[test]
fn fallback_rotates_whole_records_and_stays_bounded() {
    use std::os::unix::fs::PermissionsExt;

    let path = temp_path();
    let writer = FallbackDiagnosticsWriter::open_for_test(path.clone()).expect("open fallback");
    for index in 0..12 {
        let record = serde_json::json!({
            "index": index,
            "message": "safe ".repeat(26_000),
        })
        .to_string();
        writer.record(&record).expect("write fallback record");
    }
    let health = writer.health();
    assert!(health.bytes <= FALLBACK_TOTAL_BYTES);
    let mut retained_indices = Vec::new();
    for index in (0..=FALLBACK_ROTATED_SEGMENTS).rev() {
        let segment = if index == 0 {
            path.clone()
        } else {
            rotated_path(&path, index)
        };
        if segment.exists() {
            for line in fs::read_to_string(&segment)
                .expect("whole UTF-8 records")
                .lines()
            {
                let value =
                    serde_json::from_str::<serde_json::Value>(line).expect("whole JSON record");
                retained_indices.push(value["index"].as_u64().expect("record index"));
            }
        }
    }
    assert!(retained_indices.windows(2).all(|pair| pair[0] < pair[1]));
    assert_eq!(retained_indices.last(), Some(&11));
    assert!(retained_indices.first().copied().unwrap_or_default() > 0);
    for index in 0..=FALLBACK_ROTATED_SEGMENTS {
        let segment = if index == 0 {
            path.clone()
        } else {
            rotated_path(&path, index)
        };
        if segment.exists() {
            assert_eq!(
                fs::metadata(&segment)
                    .expect("segment metadata")
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
            assert!(
                fs::metadata(&segment).expect("segment metadata").len() <= FALLBACK_SEGMENT_BYTES
            );
            for line in fs::read_to_string(segment)
                .expect("whole UTF-8 records")
                .lines()
            {
                serde_json::from_str::<serde_json::Value>(line).expect("whole JSON record");
            }
        }
    }
    fs::remove_dir_all(path.parent().expect("fallback parent")).expect("cleanup");
}

#[test]
fn oversized_fallback_record_is_counted_not_written() {
    let path = temp_path();
    let writer = FallbackDiagnosticsWriter::open_for_test(path.clone()).expect("open fallback");
    writer
        .record(&"x".repeat(FALLBACK_SEGMENT_BYTES as usize))
        .expect("oversized record is a nonfatal drop");
    assert_eq!(writer.health().dropped_records, 1);
    assert_eq!(writer.health().bytes, 0);
    fs::remove_dir_all(path.parent().expect("fallback parent")).expect("cleanup");
}

#[test]
fn fallback_write_failure_is_nonfatal_and_visible() {
    let path = temp_path();
    let writer = FallbackDiagnosticsWriter::open_for_test(path.clone()).expect("open fallback");
    writer.inject_write_failure();

    let error = writer
        .record(r#"{"message":"retained only if the write succeeds"}"#)
        .expect_err("injected write failure must remain observable");

    assert!(error.starts_with("fallback_write_failed:"));
    assert_eq!(
        writer.health(),
        FallbackHealthV1 {
            state: FallbackStateV1::Degraded,
            bytes: 0,
            dropped_records: 1,
        }
    );
    fs::remove_dir_all(path.parent().expect("fallback parent")).expect("cleanup");
}

#[test]
fn fallback_scrubs_loopback_endpoints_and_capabilities_structurally() {
    let path = temp_path();
    let writer = FallbackDiagnosticsWriter::open_for_test(path.clone()).expect("open fallback");
    let capability = "abcdefghijklmnopqrstuvwxyzABCDEFGH123456789";
    assert_eq!(capability.len(), 43);
    writer
        .record(
            &serde_json::json!({
                "message": format!("collector at http://127.0.0.1:43123 uses {capability}"),
                "capability": capability,
                "nested": {"authorization": format!("Bearer {capability}")},
            })
            .to_string(),
        )
        .expect("write scrubbed record");

    let retained = fs::read_to_string(&path).expect("read fallback");
    assert!(!retained.contains("127.0.0.1:43123"));
    assert!(!retained.contains(capability));
    serde_json::from_str::<Value>(retained.trim()).expect("scrubbed JSON remains valid");
    fs::remove_dir_all(path.parent().expect("fallback parent")).expect("cleanup");
}
