//! Making a harness's own error text safe to persist and to render.
//!
//! Split out of the reconciler because it is a pure string transform with a security
//! argument attached, and it deserves to be readable (and testable) without the
//! surrounding concurrency machinery.

use super::fingerprint;

/// Cap on a persisted failure detail. Long enough for a real provider error,
/// short enough that a chatty harness cannot grow the document without bound.
const MAX_ATTEMPT_DETAIL_CHARS: usize = 512;

/// Marker for a redacted token, so a reader can see that something was removed
/// rather than wondering why the message reads oddly.
const REDACTED: &str = "[redacted]";

/// Make a failure detail safe to persist and to render.
///
/// Two hazards, both real. The text is **harness-controlled**: it is a spawned
/// CLI's own error string, and several of them quote the credential they were
/// handed back at you ("invalid api key: sk-ant-…"). It then lands in
/// `lastAttempt.detail`, which the status route serves as `lastError` and a UI
/// renders — so a bad key would be displayed, and stored, in cleartext. And it is
/// **unbounded**, so a harness that dumps a stack trace per attempt grows a document
/// the runtime re-reads and re-writes on every probe.
///
/// Redaction works by DIGEST, not by holding the secret: each whitespace-delimited
/// token is hashed the same way phase A hashed the credential values, and a token
/// whose digest matches one of them is replaced. That keeps this function — and the
/// engine — free of plaintext credentials, which is the property the whole two-phase
/// seam exists to preserve. It is exact rather than heuristic: no prefix guessing, no
/// regex over key shapes.
///
/// Truncation is by CHARACTER, not by byte, so a multi-byte boundary cannot be split
/// into invalid UTF-8.
pub(super) fn redact_and_truncate(detail: &str, credential_digests: &[String]) -> String {
    let matches_credential = |candidate: &str| {
        !candidate.is_empty() && credential_digests.contains(&fingerprint::digest_of(candidate))
    };

    let mut redacted = String::with_capacity(detail.len());
    for (index, token) in detail.split_whitespace().enumerate() {
        if index > 0 {
            redacted.push(' ');
        }
        // Peel the wrappers a provider actually puts around a key it is complaining
        // about: surrounding punctuation/quotes, and a `name=`/`name:` prefix. Both
        // are needed — `"sk-secret"` and `key=sk-secret,` are both real shapes, and
        // matching only the bare token would leave the second one in the document.
        // Whatever the peel leaves is compared as a whole, so the redaction stays an
        // exact digest match rather than a substring heuristic.
        let trimmed = trim_message_punctuation(token);
        let after_assignment = trimmed
            .split_once(['=', ':'])
            .map(|(_, value)| trim_message_punctuation(value));

        if matches_credential(trimmed) {
            redacted.push_str(REDACTED);
        } else if after_assignment.is_some_and(matches_credential) {
            // Keep the label, redact only the value: "key=[redacted]" says more than
            // a bare marker.
            let label_len = trimmed
                .find(['=', ':'])
                .expect("split_once found a separator");
            redacted.push_str(&trimmed[..=label_len]);
            redacted.push_str(REDACTED);
        } else {
            redacted.push_str(token);
        }
    }
    if redacted.chars().count() <= MAX_ATTEMPT_DETAIL_CHARS {
        return redacted;
    }
    let kept: String = redacted.chars().take(MAX_ATTEMPT_DETAIL_CHARS).collect();
    format!("{kept}… (truncated)")
}

/// Strip the punctuation a prose error message wraps a value in.
fn trim_message_punctuation(token: &str) -> &str {
    token.trim_matches(|character: char| {
        matches!(
            character,
            '"' | '\'' | '`' | ',' | ';' | '.' | '(' | ')' | '[' | ']' | '{' | '}' | '<' | '>'
        )
    })
}
