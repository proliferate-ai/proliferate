use std::sync::OnceLock;

use regex::Regex;

use super::super::schema::enums::SupportSecretClassV1;
use super::accounting::{redaction_marker, SupportScrubAccounting};
use super::SupportScrubError;

pub(super) struct PatternOutput {
    pub(super) value: String,
    pub(super) redacted: bool,
}

pub(super) fn apply(
    input: String,
    allow_opaque_credential: bool,
    has_unscanned_tail: bool,
    accounting: &mut SupportScrubAccounting,
) -> Result<PatternOutput, SupportScrubError> {
    let mut value = input;
    let mut redacted = false;

    redacted |= redact_unresolved_url_authority(&mut value, has_unscanned_tail, accounting)?;
    redacted |= replace_without_marker(
        &mut value,
        url_userinfo_regex(),
        "${scheme}${host}",
        SupportSecretClassV1::UrlUserinfo,
        accounting,
    )?;
    redacted |= replace_with_prefix(
        &mut value,
        signed_url_regex(),
        SupportSecretClassV1::SignedUrl,
        accounting,
    )?;
    redacted |= replace_with_prefix(
        &mut value,
        authorization_label_regex(),
        SupportSecretClassV1::Authorization,
        accounting,
    )?;
    redacted |= replace_with_prefix(
        &mut value,
        cookie_label_regex(),
        SupportSecretClassV1::Cookie,
        accounting,
    )?;
    for (regex, class) in labeled_secret_regexes() {
        redacted |= replace_with_prefix(&mut value, regex, *class, accounting)?;
    }
    redacted |= replace_with_prefix(
        &mut value,
        environment_assignment_regex(),
        SupportSecretClassV1::EnvironmentSecret,
        accounting,
    )?;
    redacted |= replace_direct(
        &mut value,
        private_key_regex(),
        SupportSecretClassV1::PrivateKey,
        accounting,
    )?;
    redacted |= replace_direct(
        &mut value,
        provider_credential_regex(),
        SupportSecretClassV1::ProviderCredential,
        accounting,
    )?;
    redacted |= replace_direct(
        &mut value,
        authorization_scheme_regex(),
        SupportSecretClassV1::Authorization,
        accounting,
    )?;
    if allow_opaque_credential {
        redacted |= replace_high_confidence_opaque(&mut value, accounting)?;
    }

    Ok(PatternOutput { value, redacted })
}

/// An authority containing userinfo can be arbitrarily long, so the `@`
/// delimiter may sit beyond the fixed regex overlap. If an authority is still
/// unresolved at the scan cutoff, fail closed at the scheme instead of
/// allowing earlier redactions to promote a possible userinfo prefix.
fn redact_unresolved_url_authority(
    value: &mut String,
    has_unscanned_tail: bool,
    accounting: &mut SupportScrubAccounting,
) -> Result<bool, SupportScrubError> {
    if !has_unscanned_tail {
        return Ok(false);
    }
    let lower = value.to_ascii_lowercase();
    let mut unresolved = None;
    for scheme in ["https://", "http://", "wss://", "ws://"] {
        for (start, _) in lower.match_indices(scheme) {
            let authority = &lower[start + scheme.len()..];
            if authority
                .bytes()
                .any(|byte| byte.is_ascii_whitespace() || matches!(byte, b'/' | b'?' | b'#'))
            {
                continue;
            }
            if authority
                .rfind('@')
                .is_some_and(|separator| separator + 1 < authority.len())
            {
                continue;
            }
            unresolved = Some(unresolved.map_or(start, |current: usize| current.min(start)));
        }
    }
    let Some(start) = unresolved else {
        return Ok(false);
    };

    value.truncate(start);
    value.push_str(redaction_marker(SupportSecretClassV1::UrlUserinfo));
    accounting.record_secret(SupportSecretClassV1::UrlUserinfo, 1)?;
    Ok(true)
}

fn replace_with_prefix(
    value: &mut String,
    regex: &Regex,
    class: SupportSecretClassV1,
    accounting: &mut SupportScrubAccounting,
) -> Result<bool, SupportScrubError> {
    let count = match_count(regex, value)?;
    if count == 0 {
        return Ok(false);
    }
    accounting.record_secret(class, count)?;
    let replacement = format!("${{prefix}}{}", redaction_marker(class));
    *value = regex.replace_all(value, replacement.as_str()).into_owned();
    Ok(true)
}

fn replace_direct(
    value: &mut String,
    regex: &Regex,
    class: SupportSecretClassV1,
    accounting: &mut SupportScrubAccounting,
) -> Result<bool, SupportScrubError> {
    let count = match_count(regex, value)?;
    if count == 0 {
        return Ok(false);
    }
    accounting.record_secret(class, count)?;
    *value = regex
        .replace_all(value, redaction_marker(class))
        .into_owned();
    Ok(true)
}

fn replace_without_marker(
    value: &mut String,
    regex: &Regex,
    replacement: &str,
    class: SupportSecretClassV1,
    accounting: &mut SupportScrubAccounting,
) -> Result<bool, SupportScrubError> {
    let count = match_count(regex, value)?;
    if count == 0 {
        return Ok(false);
    }
    accounting.record_secret(class, count)?;
    *value = regex.replace_all(value, replacement).into_owned();
    Ok(true)
}

fn match_count(regex: &Regex, value: &str) -> Result<u64, SupportScrubError> {
    u64::try_from(regex.find_iter(value).count()).map_err(|_| SupportScrubError::AccountingOverflow)
}

fn replace_high_confidence_opaque(
    value: &mut String,
    accounting: &mut SupportScrubAccounting,
) -> Result<bool, SupportScrubError> {
    let mut output = String::with_capacity(value.len());
    let mut prior = 0;
    let mut count = 0_u64;
    let bytes = value.as_bytes();
    let mut start = 0;
    while start < bytes.len() {
        if !opaque_byte(bytes[start]) {
            start += 1;
            continue;
        }
        let mut end = start + 1;
        while end < bytes.len() && opaque_byte(bytes[end]) {
            end += 1;
        }
        if end - start >= 48 && is_high_confidence_opaque(&value[start..end]) {
            output.push_str(&value[prior..start]);
            output.push_str(redaction_marker(SupportSecretClassV1::OpaqueCredential));
            prior = end;
            count = count
                .checked_add(1)
                .ok_or(SupportScrubError::AccountingOverflow)?;
        }
        start = end;
    }
    if count == 0 {
        return Ok(false);
    }
    output.push_str(&value[prior..]);
    accounting.record_secret(SupportSecretClassV1::OpaqueCredential, count)?;
    *value = output;
    Ok(true)
}

fn opaque_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'+' | b'/' | b'=' | b'-')
}

fn is_high_confidence_opaque(candidate: &str) -> bool {
    let mut lower = false;
    let mut upper = false;
    let mut digit = false;
    let mut symbol = false;
    let mut distinct = [false; 128];
    for byte in candidate.bytes() {
        lower |= byte.is_ascii_lowercase();
        upper |= byte.is_ascii_uppercase();
        digit |= byte.is_ascii_digit();
        symbol |= matches!(byte, b'_' | b'+' | b'/' | b'=' | b'-');
        if byte.is_ascii() {
            distinct[usize::from(byte)] = true;
        }
    }
    let classes = [lower, upper, digit, symbol]
        .into_iter()
        .filter(|present| *present)
        .count();
    let distinct = distinct.into_iter().filter(|present| *present).count();
    classes >= 3 && distinct >= 10
}

fn url_userinfo_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r"(?i)\b(?P<scheme>(?:https?|wss?)://)[^\s/?#]+@(?P<host>[^\s/?#@]+)")
            .expect("fixed URL-userinfo regex")
    })
}

fn signed_url_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(
            r"(?i)(?P<prefix>[?&](?:x-amz-signature|x-amz-credential|x-amz-security-token|signature|sig|security-token|security_token|credential|authorization|access_token|refresh_token|identity_token|id_token|api_key|client_secret|password|token)=)[^&#\s]+",
        )
        .expect("fixed signed-URL regex")
    })
}

fn authorization_label_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(
            r#"(?im)(?P<prefix>(?:^|[\s{\[(,;])["']?(?:authorization|proxy[-_ ]authorization|auth[-_ ]header)["']?\s*[:=]\s*)(?:bearer\s+|basic\s+)?(?:"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?|[^\r\n]+)"#,
        )
        .expect("fixed authorization-label regex")
    })
}

fn cookie_label_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(
            r#"(?im)(?P<prefix>(?:^|[\s{\[(,;])["']?(?:cookie|set[-_ ]cookie)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?|[^\r\n]+)"#,
        )
        .expect("fixed cookie-label regex")
    })
}

fn labeled_secret_regexes() -> &'static [(Regex, SupportSecretClassV1)] {
    static REGEXES: OnceLock<Vec<(Regex, SupportSecretClassV1)>> = OnceLock::new();
    REGEXES.get_or_init(|| {
        [
            (
                r#"(?im)(?P<prefix>(?:^|[\s{\[(,;])["']?(?:access[-_ ]token|bearer[-_ ]token|raw[-_ ]token)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?|[^\s,;}\]\)&]+)"#,
                SupportSecretClassV1::AccessToken,
            ),
            (
                r#"(?im)(?P<prefix>(?:^|[\s{\[(,;])["']?refresh[-_ ]token["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?|[^\s,;}\]\)&]+)"#,
                SupportSecretClassV1::RefreshToken,
            ),
            (
                r#"(?im)(?P<prefix>(?:^|[\s{\[(,;])["']?(?:identity[-_ ]token|id[-_ ]token)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?|[^\s,;}\]\)&]+)"#,
                SupportSecretClassV1::IdentityToken,
            ),
            (
                r#"(?im)(?P<prefix>(?:^|[\s{\[(,;])["']?(?:api[-_ ]key|x[-_ ]api[-_ ]key)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?|[^\s,;}\]\)&]+)"#,
                SupportSecretClassV1::ApiKey,
            ),
            (
                r#"(?im)(?P<prefix>(?:^|[\s{\[(,;])["']?client[-_ ]secret["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?|[^\s,;}\]\)&]+)"#,
                SupportSecretClassV1::ClientSecret,
            ),
            (
                r#"(?im)(?P<prefix>(?:^|[\s{\[(,;])["']?(?:password|passphrase)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?|[^\s,;}\]\)&]+)"#,
                SupportSecretClassV1::Password,
            ),
        ]
        .into_iter()
        .map(|(pattern, class)| {
            (
                Regex::new(pattern).expect("fixed labeled-secret regex"),
                class,
            )
        })
        .collect()
    })
}

fn environment_assignment_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(
            r#"(?im)(?P<prefix>(?:^|[\s{\[(,;])["']?(?:[a-z][a-z0-9]*_)+(?:token|key|secret|password|pass|credential)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?|[^\s,;}\]\)&]+)"#,
        )
        .expect("fixed environment-secret regex")
    })
}

fn private_key_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(
            r"(?s)-----BEGIN [^-\n]*PRIVATE KEY-----.*?(?:-----END [^-\n]*PRIVATE KEY-----|$)",
        )
        .expect("fixed private-key regex")
    })
}

fn provider_credential_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(
            r"\b(?:ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}|(?:AKIA|ASIA)[A-Z0-9]{16})\b",
        )
        .expect("fixed provider-credential regex")
    })
}

fn authorization_scheme_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r"(?i)\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{4,}")
            .expect("fixed authorization-scheme regex")
    })
}
