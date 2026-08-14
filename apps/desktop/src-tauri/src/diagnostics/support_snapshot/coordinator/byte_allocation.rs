use super::super::assembly::SupportAssemblyCandidateV1;

/// Allocate one exact measured response-body total across its retained atoms.
/// Every retained atom gets a positive share, every removed atom gets zero,
/// and the sum is exactly the supplied total. This keeps accounting truthful
/// under later rank/cap degradation without inventing serialized item sizes.
pub(super) fn allocate_exact_response_bytes<T>(
    candidates: &mut [SupportAssemblyCandidateV1<T>],
    total_bytes: u64,
) -> Result<(), ()> {
    for candidate in candidates.iter_mut() {
        candidate.included_bytes = 0;
    }
    let retained = candidates
        .iter()
        .filter(|candidate| candidate.scrubbed.value.is_some())
        .count() as u64;
    if retained == 0 {
        return Ok(());
    }
    if total_bytes < retained {
        return Err(());
    }
    let base = total_bytes / retained;
    let mut remainder = total_bytes % retained;
    for candidate in candidates
        .iter_mut()
        .filter(|candidate| candidate.scrubbed.value.is_some())
    {
        candidate.included_bytes = base + u64::from(remainder > 0);
        remainder = remainder.saturating_sub(1);
    }
    Ok(())
}

pub(super) fn allocate_exact_response_bytes_refs<T>(
    candidates: &mut [&mut SupportAssemblyCandidateV1<T>],
    total_bytes: u64,
) -> Result<(), ()> {
    for candidate in candidates.iter_mut() {
        candidate.included_bytes = 0;
    }
    let retained = candidates
        .iter()
        .filter(|candidate| candidate.scrubbed.value.is_some())
        .count() as u64;
    if retained == 0 {
        return Ok(());
    }
    if total_bytes < retained {
        return Err(());
    }
    let base = total_bytes / retained;
    let mut remainder = total_bytes % retained;
    for candidate in candidates
        .iter_mut()
        .filter(|candidate| candidate.scrubbed.value.is_some())
    {
        candidate.included_bytes = base + u64::from(remainder > 0);
        remainder = remainder.saturating_sub(1);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagnostics::support_snapshot::scrub::{
        SupportOptionalScrubbed, SupportScrubAccounting,
    };

    fn candidate(value: Option<u8>) -> SupportAssemblyCandidateV1<u8> {
        SupportAssemblyCandidateV1 {
            scrubbed: SupportOptionalScrubbed {
                value,
                accounting: SupportScrubAccounting::default(),
            },
            included_bytes: 99,
            original_index: 0,
        }
    }

    #[test]
    fn every_retained_sibling_has_a_positive_bounded_share() {
        let mut candidates = vec![candidate(Some(1)), candidate(None), candidate(Some(2))];
        allocate_exact_response_bytes(&mut candidates, 5).expect("allocation");
        assert_eq!(candidates[0].included_bytes, 3);
        assert_eq!(candidates[1].included_bytes, 0);
        assert_eq!(candidates[2].included_bytes, 2);
        assert_eq!(
            candidates
                .iter()
                .map(|candidate| candidate.included_bytes)
                .sum::<u64>(),
            5
        );
    }
}
