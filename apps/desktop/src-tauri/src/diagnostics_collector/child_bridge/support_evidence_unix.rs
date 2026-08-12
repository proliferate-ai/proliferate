use std::{
    collections::BTreeSet,
    os::fd::OwnedFd,
    path::{Component, Path},
};

use super::{
    EvidenceLine, EvidenceParser, EvidenceSegmentRead, EvidenceSegmentState, EvidenceSource,
    EvidenceSourceRead, EvidenceSourceState, FiniteEvidenceCapture, FiniteEvidenceRoots,
    ALL_FILES_READ_BYTES, COMPONENT_FILES_READ_BYTES, DESKTOP_ACTIVE_READ_BYTES, FALLBACK_SEGMENTS,
    LEGACY_SEGMENTS, MAX_RETAINED_LINES_PER_SOURCE, MAX_WORKER_LEGACY_TARGETS, SOURCE_LINE_BYTES,
};

#[path = "support_evidence_io.rs"]
mod evidence_io;

use crate::{
    commands::cloud_worker::spawn::worker_legacy_log_paths,
    diagnostics_collector::child_bridge::fallback_root::{
        open_read_only_root, ReadOnlyRootOutcome, ReadOnlyRootPolicy,
    },
};
use evidence_io::{
    open_evidence_file, parse_line, read_snapshotted_tail_with, EvidenceReadHook, OpenFileError,
    SystemEvidenceReadHook,
};

struct Budget {
    remaining: u64,
}

struct SourceSpec<'a> {
    source: EvidenceSource,
    parent: &'a Path,
    components: &'a [&'a str],
    leaf: &'a str,
    segments: &'a [(&'a str, u8)],
    parser: EvidenceParser,
    root_policy: ReadOnlyRootPolicy,
    exact_file_mode: Option<u32>,
    active_budget: u64,
    family_remaining: &'a mut u64,
}

pub(super) fn collect_finite_evidence(roots: &FiniteEvidenceRoots) -> FiniteEvidenceCapture {
    collect_finite_evidence_with(roots, &mut SystemEvidenceReadHook)
}

fn collect_finite_evidence_with<Reader: EvidenceReadHook + ?Sized>(
    roots: &FiniteEvidenceRoots,
    reader: &mut Reader,
) -> FiniteEvidenceCapture {
    let mut global = Budget {
        remaining: ALL_FILES_READ_BYTES,
    };
    let mut desktop_family = COMPONENT_FILES_READ_BYTES;
    let mut anyharness_family = COMPONENT_FILES_READ_BYTES;
    let mut worker_family = COMPONENT_FILES_READ_BYTES;
    let mut sources = Vec::with_capacity(7 + roots.worker_target_ids.len() * 2);

    sources.push(read_source(
        SourceSpec {
            source: EvidenceSource::DesktopNativeFallback,
            parent: &roots.desktop_logs,
            components: &[],
            leaf: "desktop-native.log",
            segments: &FALLBACK_SEGMENTS,
            parser: EvidenceParser::DesktopMixed,
            root_policy: ReadOnlyRootPolicy::ActiveFallback,
            exact_file_mode: Some(0o600),
            active_budget: DESKTOP_ACTIVE_READ_BYTES,
            family_remaining: &mut desktop_family,
        },
        &mut global,
        reader,
    ));
    if let Some(runtime_home) = roots.anyharness_runtime_home.as_deref() {
        sources.push(read_source(
            SourceSpec {
                source: EvidenceSource::AnyharnessFallback,
                parent: runtime_home,
                components: &["logs", "diagnostics-fallback"],
                leaf: "anyharness.jsonl",
                segments: &FALLBACK_SEGMENTS,
                parser: EvidenceParser::AnyharnessWrapped,
                root_policy: ReadOnlyRootPolicy::ActiveFallback,
                exact_file_mode: Some(0o600),
                active_budget: COMPONENT_FILES_READ_BYTES,
                family_remaining: &mut anyharness_family,
            },
            &mut global,
            reader,
        ));
    } else {
        sources.push(EvidenceSourceRead::omitted(
            EvidenceSource::AnyharnessFallback,
        ));
    }
    sources.push(read_source(
        SourceSpec {
            source: EvidenceSource::DesktopWorkerFallback,
            parent: &roots.desktop_logs,
            components: &["diagnostics-fallback"],
            leaf: "desktop-worker.jsonl",
            segments: &FALLBACK_SEGMENTS,
            parser: EvidenceParser::DesktopWorkerWrapped,
            root_policy: ReadOnlyRootPolicy::ActiveFallback,
            exact_file_mode: Some(0o600),
            active_budget: COMPONENT_FILES_READ_BYTES,
            family_remaining: &mut worker_family,
        },
        &mut global,
        reader,
    ));

    // Structured active evidence is always attempted before compatibility
    // prose when either a logical-family or global budget is exhausted.
    sources.push(read_source(
        SourceSpec {
            source: EvidenceSource::RendererLegacy,
            parent: &roots.desktop_logs,
            components: &[],
            leaf: "renderer-diagnostics.log",
            segments: &LEGACY_SEGMENTS,
            parser: EvidenceParser::Legacy,
            root_policy: ReadOnlyRootPolicy::HistoricalCompatibility,
            exact_file_mode: None,
            active_budget: u64::MAX,
            family_remaining: &mut desktop_family,
        },
        &mut global,
        reader,
    ));
    if let Some(runtime_home) = roots.anyharness_runtime_home.as_deref() {
        sources.push(read_source(
            SourceSpec {
                source: EvidenceSource::AnyharnessLegacy,
                parent: runtime_home,
                components: &["logs"],
                leaf: "anyharness.log",
                segments: &LEGACY_SEGMENTS,
                parser: EvidenceParser::Legacy,
                root_policy: ReadOnlyRootPolicy::HistoricalCompatibility,
                exact_file_mode: None,
                active_budget: u64::MAX,
                family_remaining: &mut anyharness_family,
            },
            &mut global,
            reader,
        ));
    } else {
        sources.push(EvidenceSourceRead::omitted(
            EvidenceSource::AnyharnessLegacy,
        ));
    }

    let targets = roots
        .worker_target_ids
        .iter()
        .filter(|target| !target.is_empty())
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    let targets_omitted = targets.len().saturating_sub(MAX_WORKER_LEGACY_TARGETS) as u64;
    let mut seen_v2 = BTreeSet::new();
    let mut seen_v1 = BTreeSet::new();
    let mut worker_v2 = EvidenceSourceRead::omitted(EvidenceSource::WorkerLegacyV2);
    let mut worker_v1 = EvidenceSourceRead::omitted(EvidenceSource::WorkerLegacyV1);
    for target in targets.iter().copied().take(MAX_WORKER_LEGACY_TARGETS) {
        let paths = worker_legacy_log_paths(&roots.app_dir, target);
        if seen_v2.insert(paths.v2.clone()) {
            let candidate = read_worker_legacy(
                &roots.app_dir,
                &paths.v2,
                EvidenceSource::WorkerLegacyV2,
                &mut worker_family,
                &mut global,
                reader,
            );
            merge_worker_source(&mut worker_v2, candidate);
        }
        if seen_v1.insert(paths.v1.clone()) {
            let candidate = read_worker_legacy(
                &roots.app_dir,
                &paths.v1,
                EvidenceSource::WorkerLegacyV1,
                &mut worker_family,
                &mut global,
                reader,
            );
            merge_worker_source(&mut worker_v1, candidate);
        }
    }
    worker_v2.omitted_by_cap += targets_omitted;
    worker_v1.omitted_by_cap += targets_omitted;
    sources.push(worker_v2);
    sources.push(worker_v1);

    FiniteEvidenceCapture {
        total_read_bytes: ALL_FILES_READ_BYTES - global.remaining,
        sources,
    }
}

fn read_worker_legacy(
    app_dir: &Path,
    path: &Path,
    source: EvidenceSource,
    family_remaining: &mut u64,
    global: &mut Budget,
    reader: &mut (impl EvidenceReadHook + ?Sized),
) -> EvidenceSourceRead {
    let Some(parent) = path.parent() else {
        return EvidenceSourceRead::omitted(source);
    };
    let Ok(relative) = parent.strip_prefix(app_dir) else {
        return EvidenceSourceRead::omitted(source);
    };
    let mut components = Vec::new();
    for component in relative.components() {
        let Component::Normal(component) = component else {
            return EvidenceSourceRead::omitted(source);
        };
        let Some(component) = component.to_str() else {
            return EvidenceSourceRead::omitted(source);
        };
        components.push(component);
    }
    read_source(
        SourceSpec {
            source,
            parent: app_dir,
            components: &components,
            leaf: "worker.log",
            segments: &[("{leaf}", 0)],
            parser: EvidenceParser::Legacy,
            root_policy: ReadOnlyRootPolicy::HistoricalCompatibility,
            exact_file_mode: None,
            active_budget: u64::MAX,
            family_remaining,
        },
        global,
        reader,
    )
}

fn merge_worker_source(target: &mut EvidenceSourceRead, mut candidate: EvidenceSourceRead) {
    target.read_bytes += candidate.read_bytes;
    target.included_bytes += candidate.included_bytes;
    target.invalid_lines += candidate.invalid_lines;
    target.invalid_utf8_bytes += candidate.invalid_utf8_bytes;
    target.incomplete_leading_bytes += candidate.incomplete_leading_bytes;
    target.incomplete_final_bytes += candidate.incomplete_final_bytes;
    target.oversized_line_bytes += candidate.oversized_line_bytes;
    target.omitted_by_cap += candidate.omitted_by_cap;
    let line_base = target.lines.len() as u64;
    for (index, line) in candidate.lines.iter_mut().enumerate() {
        line.line = line_base + index as u64 + 1;
    }
    target.lines.append(&mut candidate.lines);
    target.segments.append(&mut candidate.segments);
    target.state = merge_source_state(target.state, candidate.state);
}

fn merge_source_state(
    left: EvidenceSourceState,
    right: EvidenceSourceState,
) -> EvidenceSourceState {
    use EvidenceSourceState::{Included, Invalid, Missing, Omitted, Unreadable, UnsafeMetadata};
    match (left, right) {
        (Included, _) | (_, Included) => Included,
        (UnsafeMetadata, _) | (_, UnsafeMetadata) => UnsafeMetadata,
        (Unreadable, _) | (_, Unreadable) => Unreadable,
        (Invalid, _) | (_, Invalid) => Invalid,
        (Missing, _) | (_, Missing) => Missing,
        _ => Omitted,
    }
}

fn read_source(
    mut spec: SourceSpec<'_>,
    global: &mut Budget,
    reader: &mut (impl EvidenceReadHook + ?Sized),
) -> EvidenceSourceRead {
    let mut result = EvidenceSourceRead::omitted(spec.source);
    if global.remaining == 0 || *spec.family_remaining == 0 {
        result.omitted_by_cap = 1;
        return result;
    }
    let root = match open_read_only_root(spec.parent, spec.components, spec.root_policy) {
        ReadOnlyRootOutcome::Available(root) => root,
        ReadOnlyRootOutcome::Missing => {
            result.state = EvidenceSourceState::Missing;
            return result;
        }
        ReadOnlyRootOutcome::Unreadable => {
            result.state = EvidenceSourceState::Unreadable;
            return result;
        }
        ReadOnlyRootOutcome::UnsafeMetadata => {
            result.state = EvidenceSourceState::UnsafeMetadata;
            return result;
        }
    };

    let source_budget = spec
        .active_budget
        .min(*spec.family_remaining)
        .min(global.remaining);
    let snapshots = snapshot_segments(&root, spec.leaf, spec.segments, spec.exact_file_mode);
    select_and_parse(&mut result, snapshots, spec.parser, source_budget, reader);
    *spec.family_remaining = spec.family_remaining.saturating_sub(result.read_bytes);
    global.remaining = global.remaining.saturating_sub(result.read_bytes);
    result.state = source_state(&result);
    result
}

struct SegmentSnapshot {
    segment: u8,
    state: EvidenceSegmentState,
    descriptor: Option<OwnedFd>,
    length: u64,
}

fn snapshot_segments(
    root: &OwnedFd,
    leaf: &str,
    segments: &[(&str, u8)],
    exact_mode: Option<u32>,
) -> Vec<SegmentSnapshot> {
    segments
        .iter()
        .map(|(template, segment)| {
            let name = template.replace("{leaf}", leaf);
            match open_evidence_file(root, &name, exact_mode) {
                Ok((descriptor, length)) => SegmentSnapshot {
                    segment: *segment,
                    state: EvidenceSegmentState::Available,
                    descriptor: Some(descriptor),
                    length,
                },
                Err(OpenFileError::Missing) => SegmentSnapshot {
                    segment: *segment,
                    state: EvidenceSegmentState::Missing,
                    descriptor: None,
                    length: 0,
                },
                Err(OpenFileError::Unreadable) => SegmentSnapshot {
                    segment: *segment,
                    state: EvidenceSegmentState::Unreadable,
                    descriptor: None,
                    length: 0,
                },
                Err(OpenFileError::Unsafe) => SegmentSnapshot {
                    segment: *segment,
                    state: EvidenceSegmentState::UnsafeMetadata,
                    descriptor: None,
                    length: 0,
                },
            }
        })
        .collect()
}

fn select_and_parse(
    result: &mut EvidenceSourceRead,
    mut snapshots: Vec<SegmentSnapshot>,
    parser: EvidenceParser,
    budget: u64,
    reader: &mut (impl EvidenceReadHook + ?Sized),
) {
    let mut remaining = budget;
    let mut retained = Vec::new();
    // Select newest complete lines first: active to oldest rotation, and each
    // segment from its end. Presentation is restored afterward.
    for snapshot in snapshots.iter_mut().rev() {
        if remaining == 0 {
            snapshot.state = EvidenceSegmentState::SourceCap;
            result.omitted_by_cap += 1;
            continue;
        }
        let Some(descriptor) = snapshot.descriptor.as_ref() else {
            continue;
        };
        let to_read = snapshot.length.min(remaining);
        let tail = read_snapshotted_tail_with(reader, descriptor, snapshot.length, to_read);
        remaining = remaining.saturating_sub(tail.read_bytes);
        result.read_bytes += tail.read_bytes;
        if tail.error_kind.is_some() {
            result.segments.push(EvidenceSegmentRead {
                segment: snapshot.segment,
                state: EvidenceSegmentState::Unreadable,
                snapshotted_bytes: snapshot.length,
                read_bytes: tail.read_bytes,
            });
            continue;
        }
        result.incomplete_leading_bytes += tail.incomplete_leading_bytes;
        result.incomplete_final_bytes += tail.incomplete_final_bytes;
        for (line, bytes) in tail.lines.into_iter().rev() {
            if retained.len() >= MAX_RETAINED_LINES_PER_SOURCE {
                result.omitted_by_cap += 1;
                continue;
            }
            if bytes.len() > SOURCE_LINE_BYTES {
                result.oversized_line_bytes += bytes.len() as u64;
                result.invalid_lines += 1;
                continue;
            }
            match parse_line(parser, &bytes) {
                Some((value, invalid_utf8_bytes)) => {
                    result.included_bytes += bytes.len() as u64;
                    result.invalid_utf8_bytes += invalid_utf8_bytes;
                    retained.push(EvidenceLine {
                        segment: snapshot.segment,
                        line,
                        value,
                    });
                }
                None => result.invalid_lines += 1,
            }
        }
        result.segments.push(EvidenceSegmentRead {
            segment: snapshot.segment,
            state: if to_read < snapshot.length {
                result.omitted_by_cap += 1;
                EvidenceSegmentState::SourceCap
            } else {
                EvidenceSegmentState::Available
            },
            snapshotted_bytes: snapshot.length,
            read_bytes: tail.read_bytes,
        });
    }
    for snapshot in snapshots {
        if !result
            .segments
            .iter()
            .any(|segment| segment.segment == snapshot.segment)
        {
            result.segments.push(EvidenceSegmentRead {
                segment: snapshot.segment,
                state: snapshot.state,
                snapshotted_bytes: snapshot.length,
                read_bytes: 0,
            });
        }
    }
    result
        .segments
        .sort_by_key(|segment| std::cmp::Reverse(segment.segment));
    retained.sort_by_key(|line| (std::cmp::Reverse(line.segment), line.line));
    result.lines = retained;
}

#[cfg(test)]
#[path = "support_evidence_accounting_tests.rs"]
mod accounting_tests;

fn source_state(result: &EvidenceSourceRead) -> EvidenceSourceState {
    if !result.lines.is_empty() {
        EvidenceSourceState::Included
    } else if result
        .segments
        .iter()
        .any(|segment| segment.state == EvidenceSegmentState::UnsafeMetadata)
    {
        EvidenceSourceState::UnsafeMetadata
    } else if result
        .segments
        .iter()
        .any(|segment| segment.state == EvidenceSegmentState::Unreadable)
    {
        EvidenceSourceState::Unreadable
    } else if result.invalid_lines > 0 {
        EvidenceSourceState::Invalid
    } else if result
        .segments
        .iter()
        .any(|segment| segment.state == EvidenceSegmentState::SourceCap)
    {
        EvidenceSourceState::Omitted
    } else if result
        .segments
        .iter()
        .all(|segment| segment.state == EvidenceSegmentState::Missing)
    {
        EvidenceSourceState::Missing
    } else {
        EvidenceSourceState::Included
    }
}
