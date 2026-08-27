const EXTERNAL_BINARY_COUNT: usize = 4;

pub(crate) fn should_stage_real_binaries(
    cargo_primary_package: bool,
    explicit_inputs: [bool; EXTERNAL_BINARY_COUNT],
    _release_profile: bool,
) -> bool {
    let explicit_count = explicit_inputs
        .into_iter()
        .filter(|present| *present)
        .count();
    cargo_primary_package || explicit_count == EXTERNAL_BINARY_COUNT
}

pub(crate) fn is_placeholder_executable(prefix: &[u8]) -> bool {
    let lower = prefix
        .iter()
        .map(|byte| byte.to_ascii_lowercase())
        .collect::<Vec<_>>();
    lower == b"unsupported target placeholder"
        || (lower.starts_with(b"#!/bin/sh")
            && (contains(&lower, b"placeholder") || contains(&lower, b"is not available")))
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack
        .windows(needle.len())
        .any(|window| window == needle)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_primary_or_complete_explicit_inputs_stage_real_binaries() {
        assert!(should_stage_real_binaries(
            false,
            [true, true, true, true],
            true
        ));
        assert!(should_stage_real_binaries(
            true,
            [false, false, false, false],
            true
        ));
        assert!(!should_stage_real_binaries(
            false,
            [false, false, false, false],
            true
        ));
        assert!(!should_stage_real_binaries(
            false,
            [false, false, false, false],
            false
        ));
        assert!(!should_stage_real_binaries(
            false,
            [true, true, true, false],
            true
        ));
        assert!(!should_stage_real_binaries(
            false,
            [true, false, false, false],
            false
        ));
    }

    #[test]
    fn supported_package_placeholders_are_recognized_before_bundle() {
        assert!(is_placeholder_executable(
            b"#!/bin/sh\nprintf 'AnyHarness sidecar is not available'\nexit 1\n"
        ));
        assert!(is_placeholder_executable(
            b"#!/bin/sh\nprintf 'Proliferate diagnostics collector placeholder'\nexit 1\n"
        ));
        assert!(is_placeholder_executable(b"unsupported target placeholder"));
        assert!(!is_placeholder_executable(&[
            0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0x00, 0x00, 0x01,
        ]));
    }
}
