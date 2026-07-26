//! T-16, T-35, T-17, T-36: every stale reason and its precedence, the C8 storm
//! regression, the TTL boundary, and jitter.

use super::*;

// ---------------------------------------------------------------------------
// T-16, T-17: the gate matrix and the TTL boundary
// ---------------------------------------------------------------------------

/// T-16 — every reason, plus precedence. Identity before auth before time, so a
/// surface names the real cause rather than "it got old".
#[test]
fn the_gate_names_every_reason_and_orders_them() {
    let ttl = 24 * HOUR;
    let current = identity(Some("1.0.0"), Some("sha-new"), "pinned_archive");

    // No entry.
    assert_eq!(
        evaluate(None, Some(&current), FP, now(), ttl),
        Freshness::Stale(StaleReason::Missing)
    );

    // sha differs while versions AGREE: sha is the stronger signal and wins.
    let moved_sha = entry(
        HOUR,
        Some(identity(Some("1.0.0"), Some("sha-old"), "pinned_archive")),
        FP,
    );
    assert_eq!(
        evaluate(Some(&moved_sha), Some(&current), FP, now(), ttl),
        Freshness::Stale(StaleReason::HarnessMoved)
    );

    // versions differ with no shas on either side: the fallback comparison.
    let no_sha_current = identity(Some("2.0.0"), None, "pinned_git");
    let moved_version = entry(HOUR, Some(identity(Some("1.0.0"), None, "pinned_git")), FP);
    assert_eq!(
        evaluate(Some(&moved_version), Some(&no_sha_current), FP, now(), ttl),
        Freshness::Stale(StaleReason::HarnessMoved)
    );

    // Fingerprint moved.
    let same_identity = entry(HOUR, Some(current.clone()), "sha256:OLD");
    assert_eq!(
        evaluate(Some(&same_identity), Some(&current), FP, now(), ttl),
        Freshness::Stale(StaleReason::AuthMoved)
    );

    // Age beyond the TTL.
    let old = entry(25 * HOUR, Some(current.clone()), FP);
    assert_eq!(
        evaluate(Some(&old), Some(&current), FP, now(), ttl),
        Freshness::Stale(StaleReason::TtlExpired)
    );

    // Everything matches inside the TTL.
    let fresh = entry(HOUR, Some(current.clone()), FP);
    assert_eq!(
        evaluate(Some(&fresh), Some(&current), FP, now(), ttl),
        Freshness::Fresh
    );

    // Precedence: all three hold at once -> the identity reason is reported.
    let all_three = entry(
        99 * HOUR,
        Some(identity(Some("0.1.0"), Some("sha-ancient"), "pinned_archive")),
        "sha256:OLD",
    );
    assert_eq!(
        evaluate(Some(&all_three), Some(&current), FP, now(), ttl),
        Freshness::Stale(StaleReason::HarnessMoved),
        "identity must be reported before auth or time"
    );
    // Auth before time when identity agrees.
    let auth_and_time = entry(99 * HOUR, Some(current.clone()), "sha256:OLD");
    assert_eq!(
        evaluate(Some(&auth_and_time), Some(&current), FP, now(), ttl),
        Freshness::Stale(StaleReason::AuthMoved)
    );
}

/// T-35 — **the C8 storm regression.** Every unobservable-identity case must be
/// NOT stale. Getting this wrong made three of five harnesses permanently
/// `HarnessMoved`, re-spawning a real harness on every startup, every launch and
/// every auth apply — with backoff powerless, because those probes SUCCEED.
#[test]
fn an_unobservable_install_identity_is_never_a_staleness_reason() {
    let ttl = 24 * HOUR;
    let manifest = identity(
        Some("26f9ee7a0049507bff5476ce390695515ce92840"),
        Some("b206d72da2ff"),
        "pinned_git",
    );

    // (a) The entry predates the field, with a present manifest.
    let pre_field = entry(HOUR, None, FP);
    assert_eq!(
        evaluate(Some(&pre_field), Some(&manifest), FP, now(), ttl),
        Freshness::Fresh,
        "an entry with no recorded identity must not be stale"
    );

    // (b) No manifest at all.
    let recorded = entry(HOUR, Some(manifest.clone()), FP);
    assert_eq!(
        evaluate(Some(&recorded), None, FP, now(), ttl),
        Freshness::Fresh,
        "an absent manifest must not be stale"
    );

    // (c) A `source: "path"` dev install: manifest present, version absent.
    let path_install = identity(None, None, "path");
    let recorded_path = entry(HOUR, Some(identity(None, None, "path")), FP);
    assert_eq!(
        evaluate(Some(&recorded_path), Some(&path_install), FP, now(), ttl),
        Freshness::Fresh,
        "a version-less path install must not be stale"
    );

    // The positive control, which is the exact pair rev 1 got wrong: the entry's
    // ACP attestation says `0.59.0-proliferate.1` while the manifest says the
    // pinned git sha. Same manifest on both sides => Fresh.
    assert_eq!(
        recorded.attestation.as_ref().map(|a| a.version.as_str()),
        Some("0.59.0-proliferate.1"),
        "the fixture really does carry the divergent ACP version"
    );
    assert_eq!(
        evaluate(Some(&recorded), Some(&manifest), FP, now(), ttl),
        Freshness::Fresh,
        "an entry recorded from the manifest must be fresh against that manifest, \
         regardless of what the ACP attestation says"
    );

    // A cursor/grok-shaped entry (attestation: null) with a matching identity.
    let mut attestation_less = entry(HOUR, Some(manifest.clone()), FP);
    attestation_less.attestation = None;
    assert_eq!(
        evaluate(Some(&attestation_less), Some(&manifest), FP, now(), ttl),
        Freshness::Fresh
    );
}

/// The comparison rule itself, including the "both present but no comparable
/// field" case, which is Indeterminate rather than Different.
#[test]
fn identity_comparison_prefers_sha_then_version_then_gives_up() {
    assert_eq!(
        compare_identity(
            Some(&identity(Some("1.0"), Some("sha"), "npm")),
            Some(&identity(Some("2.0"), Some("sha"), "npm")),
        ),
        IdentityComparison::Same,
        "a matching sha wins even when the version strings differ"
    );
    assert_eq!(
        compare_identity(
            Some(&identity(Some("1.0"), Some("sha-a"), "npm")),
            Some(&identity(Some("1.0"), Some("sha-b"), "npm")),
        ),
        IdentityComparison::Different,
        "a differing sha is a move even when the version string was reused"
    );
    assert_eq!(
        compare_identity(
            Some(&identity(Some("1.0"), None, "npm")),
            Some(&identity(Some("1.0"), Some("sha"), "npm")),
        ),
        IdentityComparison::Same,
        "one-sided sha falls back to the version comparison"
    );
    assert_eq!(
        compare_identity(
            Some(&identity(None, None, "path")),
            Some(&identity(None, None, "path")),
        ),
        IdentityComparison::Indeterminate,
        "two identities with nothing comparable are indeterminate, not equal"
    );
    assert_eq!(
        compare_identity(None, None),
        IdentityComparison::Indeterminate
    );
}

/// T-17 — the TTL boundary, exactly. One second under is fresh; one second over
/// expires.
#[test]
fn the_ttl_boundary_is_exact_and_a_backwards_clock_does_not_expire() {
    let ttl = Duration::from_secs(90_000);
    let current = identity(Some("1.0"), Some("sha"), "npm");

    let just_inside = entry(ttl - Duration::from_secs(1), Some(current.clone()), FP);
    assert_eq!(
        evaluate(Some(&just_inside), Some(&current), FP, now(), ttl),
        Freshness::Fresh
    );

    let just_outside = entry(ttl + Duration::from_secs(1), Some(current.clone()), FP);
    assert_eq!(
        evaluate(Some(&just_outside), Some(&current), FP, now(), ttl),
        Freshness::Stale(StaleReason::TtlExpired)
    );

    // A `probedAt` in the future (clock correction, or a document copied from a
    // machine ahead of this one) must not expire: expiring on it would re-probe
    // everything after any clock adjustment.
    let mut future = entry(Duration::ZERO, Some(current.clone()), FP);
    future.probed_at = (now() + chrono::Duration::hours(5)).to_rfc3339();
    assert_eq!(
        evaluate(Some(&future), Some(&current), FP, now(), ttl),
        Freshness::Fresh
    );

    // An unparseable timestamp IS a defect in the entry (unlike an unobservable
    // identity), and one re-probe repairs it permanently.
    let mut broken = entry(Duration::ZERO, Some(current.clone()), FP);
    broken.probed_at = "not-a-timestamp".to_string();
    assert_eq!(
        evaluate(Some(&broken), Some(&current), FP, now(), ttl),
        Freshness::Stale(StaleReason::TtlExpired)
    );
}

/// T-36 — TTL jitter is deterministic, bounded, and actually spreading.
///
/// Without it, a startup pass writes all 17 entries in one pass, they co-expire to
/// the same instant, and every boot ≥24h later queues 17 real harness spawns. The
/// design created that herd itself.
#[test]
fn ttl_jitter_is_deterministic_bounded_and_spreads_every_catalog_context() {
    let seventeen: Vec<(&str, &str)> = vec![
        ("claude", "bedrock"),
        ("claude", "anthropic-api"),
        ("claude", "anthropic-oauth"),
        ("claude", "gateway"),
        ("codex", "bedrock"),
        ("codex", "openai-oauth"),
        ("codex", "openai-api"),
        ("codex", "gateway"),
        ("cursor", "cursor-login"),
        ("grok", "xai-api"),
        ("grok", "gateway"),
        ("opencode", "anthropic-api"),
        ("opencode", "openai-api"),
        ("opencode", "gemini-api"),
        ("opencode", "opencode-zen"),
        ("opencode", "baseline"),
        ("opencode", "gateway"),
    ];
    assert_eq!(seventeen.len(), 17);

    let mut ttls: Vec<u64> = Vec::new();
    for (harness, context) in &seventeen {
        let ttl = ttl_for_entry(harness, context);
        // Pure: the same key always answers the same.
        assert_eq!(ttl, ttl_for_entry(harness, context));
        assert!(
            ttl >= DEFAULT_TTL_BASE && ttl < DEFAULT_TTL_BASE + DEFAULT_TTL_JITTER_SPAN,
            "{harness}:{context} ttl {ttl:?} outside [24h, 30h)"
        );
        ttls.push(ttl.as_secs());
    }
    ttls.sort_unstable();
    let span = ttls.last().unwrap() - ttls.first().unwrap();
    assert!(
        span >= 5 * 3600,
        "the 17 contexts must span at least 5h of the 6h window, got {span}s"
    );
    // No two entries co-expire, which is the property that matters: co-expiry is
    // what turns a startup pass into 17 back-to-back spawns.
    let mut deduped = ttls.clone();
    deduped.dedup();
    assert_eq!(
        deduped.len(),
        ttls.len(),
        "no two contexts may share a TTL"
    );
    // The AVERAGE spacing is what the design's "~21 minutes apart" refers to. A
    // hash-mod cannot guarantee a per-pair minimum, and this asserts the real
    // guarantee rather than an aspirational one: the closest pair on the shipped
    // catalog is 232s apart (just under the 240s probe timeout), so at
    // `semaphore = 1` the worst case is ONE probe waiting briefly on the gate —
    // not a herd. Asserting a 5-minute floor here would pin a property the design
    // does not actually provide.
    let average_gap = span / (ttls.len() as u64 - 1);
    assert!(
        average_gap >= 15 * 60,
        "the average spacing must stay in the tens of minutes, got {average_gap}s"
    );
    let min_gap = ttls
        .windows(2)
        .map(|pair| pair[1] - pair[0])
        .min()
        .expect("gaps");
    assert!(
        min_gap >= 120,
        "even the closest pair must not effectively co-expire, got {min_gap}s"
    );

    // A zero jitter span degrades to the flat base rather than dividing by zero.
    assert_eq!(
        ttl_for_entry_with("claude", "gateway", DEFAULT_TTL_BASE, Duration::ZERO),
        DEFAULT_TTL_BASE
    );
}
