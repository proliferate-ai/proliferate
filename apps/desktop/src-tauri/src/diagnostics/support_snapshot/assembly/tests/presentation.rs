use super::super::super::schema::enums::{
    SupportFallbackRecordComponentV1, SupportLegacySourceKindV1, SupportSourceManifestSourceV1,
};
use super::super::super::schema::model::common::SupportJsonValueV1;
use super::super::{
    assemble_support_snapshot, SupportFallbackCandidateValueV1, SupportLegacyCandidateValueV1,
    SupportSessionAssemblyV1,
};
use super::{candidate, input_from_fixture, seq_value, SCHEMA_POPULATED};

#[test]
fn final_sections_restore_their_own_normative_ascending_orders() {
    let mut input = input_from_fixture(SCHEMA_POPULATED);
    let fallback_record = input
        .fallback
        .iter()
        .find_map(|candidate| match candidate.scrubbed.value.as_ref() {
            Some(SupportFallbackCandidateValueV1::Record(record))
                if record.component == SupportFallbackRecordComponentV1::DesktopTauri =>
            {
                Some(record.clone())
            }
            _ => None,
        })
        .expect("desktop fallback record");
    let opaque = input
        .fallback
        .iter()
        .find_map(|candidate| match candidate.scrubbed.value.as_ref() {
            Some(SupportFallbackCandidateValueV1::OpaqueLine(line)) => Some(line.clone()),
            _ => None,
        })
        .expect("opaque fallback line");
    input.fallback = [(3, 0), (1, 3), (2, 2)]
        .into_iter()
        .enumerate()
        .map(|(index, (sequence, segment))| {
            let mut record = fallback_record.clone();
            record.record.producer_sequence = sequence;
            record.segment = segment;
            record.line = sequence;
            candidate(
                Some(SupportFallbackCandidateValueV1::Record(record)),
                1,
                index as u64,
            )
        })
        .chain(
            [(0, 9), (3, 1)]
                .into_iter()
                .enumerate()
                .map(|(index, (segment, line))| {
                    let mut value = opaque.clone();
                    value.segment = segment;
                    value.line = line;
                    candidate(
                        Some(SupportFallbackCandidateValueV1::OpaqueLine(value)),
                        1,
                        (index + 3) as u64,
                    )
                }),
        )
        .collect();
    set_file_read_bytes(
        &mut input,
        SupportSourceManifestSourceV1::DesktopNativeFallback,
        5,
    );

    let renderer = input
        .legacy
        .iter()
        .find_map(|candidate| {
            candidate.scrubbed.value.as_ref().and_then(|value| {
                (value.source == SupportLegacySourceKindV1::RendererDiagnostics)
                    .then_some(value.line.clone())
            })
        })
        .expect("renderer legacy line");
    input.legacy = [(0, 9), (5, 1)]
        .into_iter()
        .enumerate()
        .map(|(index, (segment, line))| {
            let mut value = renderer.clone();
            value.segment = segment;
            value.line = line;
            candidate(
                Some(SupportLegacyCandidateValueV1 {
                    source: SupportLegacySourceKindV1::RendererDiagnostics,
                    line: value,
                }),
                1,
                index as u64,
            )
        })
        .collect();
    set_file_read_bytes(&mut input, SupportSourceManifestSourceV1::RendererLegacy, 2);

    let SupportSessionAssemblyV1::Included {
        read_bytes,
        sessions,
        ..
    } = &mut input.sessions
    else {
        panic!("session fixture")
    };
    *read_bytes = 6;
    let session = &mut sessions[0];
    session.normalized_events = [3, 1, 2]
        .into_iter()
        .enumerate()
        .map(|(index, sequence)| candidate(Some(seq_value(sequence, "event")), 1, index as u64))
        .collect();
    session.raw_notifications = [5, 4]
        .into_iter()
        .enumerate()
        .map(|(index, sequence)| candidate(Some(seq_value(sequence, "raw")), 1, index as u64))
        .collect();

    let output = assemble_support_snapshot(input).expect("presentation order");
    let desktop = &output.snapshot.fallback_evidence[0];
    let super::super::super::schema::model::evidence::SupportFallbackComponentV1::Pr3DesktopNativeMixed {
        records,
        opaque_lines,
    } = desktop
    else {
        panic!("desktop fallback section")
    };
    assert_eq!(
        records
            .iter()
            .map(|record| record.record.producer_sequence)
            .collect::<Vec<_>>(),
        vec![1, 2, 3]
    );
    assert_eq!(
        opaque_lines
            .iter()
            .map(|line| line.segment)
            .collect::<Vec<_>>(),
        vec![3, 0]
    );
    let renderer = output
        .snapshot
        .legacy_evidence
        .iter()
        .find(|source| source.source == SupportLegacySourceKindV1::RendererDiagnostics)
        .expect("renderer section");
    assert_eq!(
        renderer
            .lines
            .iter()
            .map(|line| line.segment)
            .collect::<Vec<_>>(),
        vec![5, 0]
    );
    let session = &output
        .snapshot
        .session_ledger
        .as_ref()
        .expect("session ledger")
        .sessions[0];
    assert_eq!(sequences(&session.normalized_events), vec![1, 2, 3]);
    assert_eq!(sequences(&session.raw_notifications), vec![4, 5]);
}

fn sequences(values: &[SupportJsonValueV1]) -> Vec<i64> {
    values
        .iter()
        .map(|value| {
            let SupportJsonValueV1::Object(entries) = value else {
                panic!("sequence object")
            };
            let Some((_, SupportJsonValueV1::Integer(sequence))) =
                entries.iter().find(|(key, _)| key == "seq")
            else {
                panic!("sequence field")
            };
            *sequence
        })
        .collect()
}

fn set_file_read_bytes(
    input: &mut super::super::SupportAssemblyInputV1,
    source: SupportSourceManifestSourceV1,
    read_bytes: u64,
) {
    input
        .file_sources
        .iter_mut()
        .find(|capture| capture.source == source)
        .expect("file source")
        .read_bytes = read_bytes;
}
