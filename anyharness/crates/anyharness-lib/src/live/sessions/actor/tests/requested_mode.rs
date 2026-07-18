use crate::live::sessions::actor::config::handle::validate_requested_mode_outcome;
use crate::live::sessions::actor::config::types::ConfigApplyOutcome;

#[test]
fn requested_startup_mode_requires_authoritative_confirmation() {
    for outcome in [
        ConfigApplyOutcome::NoChange,
        ConfigApplyOutcome::AppliedAuthoritative,
    ] {
        validate_requested_mode_outcome("claude", "bypassPermissions", outcome)
            .expect("authoritative mode outcome should be accepted");
    }

    for outcome in [
        ConfigApplyOutcome::AppliedRequested,
        ConfigApplyOutcome::NotApplied,
    ] {
        let error = validate_requested_mode_outcome("claude", "bypassPermissions", outcome)
            .expect_err("unconfirmed mode outcome must fail session startup");
        assert_eq!(
            error.to_string(),
            "mode 'bypassPermissions' is not supported by the active session for agent 'claude'"
        );
    }
}
