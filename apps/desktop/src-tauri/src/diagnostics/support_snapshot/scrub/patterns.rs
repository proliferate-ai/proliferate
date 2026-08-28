use std::sync::OnceLock;

use regex::{Captures, Regex};

use super::super::schema::enums::SupportSecretClassV1;
use super::accounting::{redaction_marker, SupportScrubAccounting};
use super::SupportScrubError;

pub(super) struct PatternOutput {
    pub(super) value: String,
    pub(super) visible_end: usize,
    pub(super) redacted: bool,
}

pub(super) fn apply(
    input: String,
    mut visible_end: usize,
    allow_opaque_credential: bool,
    has_unscanned_tail: bool,
    accounting: &mut SupportScrubAccounting,
) -> Result<PatternOutput, SupportScrubError> {
    let mut value = input;
    let mut redacted = false;

    redacted |= redact_unresolved_uri_authority(
        &mut value,
        &mut visible_end,
        has_unscanned_tail,
        accounting,
    )?;
    redacted |= replace_userinfo(&mut value, &mut visible_end, accounting)?;
    redacted |= replace_with_prefix(
        &mut value,
        &mut visible_end,
        signed_url_regex(),
        SupportSecretClassV1::SignedUrl,
        accounting,
    )?;
    redacted |= replace_with_prefix(
        &mut value,
        &mut visible_end,
        authorization_label_regex(),
        SupportSecretClassV1::Authorization,
        accounting,
    )?;
    redacted |= replace_with_prefix(
        &mut value,
        &mut visible_end,
        cookie_label_regex(),
        SupportSecretClassV1::Cookie,
        accounting,
    )?;
    for (regex, class) in labeled_secret_regexes() {
        redacted |= replace_with_prefix(&mut value, &mut visible_end, regex, *class, accounting)?;
    }
    redacted |= replace_with_prefix(
        &mut value,
        &mut visible_end,
        environment_assignment_regex(),
        SupportSecretClassV1::EnvironmentSecret,
        accounting,
    )?;
    redacted |= replace_direct(
        &mut value,
        &mut visible_end,
        private_key_regex(),
        SupportSecretClassV1::PrivateKey,
        accounting,
    )?;
    redacted |= replace_direct(
        &mut value,
        &mut visible_end,
        provider_credential_regex(),
        SupportSecretClassV1::ProviderCredential,
        accounting,
    )?;
    redacted |= replace_direct(
        &mut value,
        &mut visible_end,
        authorization_scheme_regex(),
        SupportSecretClassV1::Authorization,
        accounting,
    )?;
    if allow_opaque_credential {
        redacted |= replace_high_confidence_opaque(&mut value, &mut visible_end, accounting)?;
    }

    Ok(PatternOutput {
        value,
        visible_end,
        redacted,
    })
}

/// An authority containing userinfo can be arbitrarily long, so the `@`
/// delimiter may sit beyond the fixed regex overlap. If an authority is still
/// unresolved at the scan cutoff, fail closed at the scheme instead of
/// allowing earlier redactions to promote a possible userinfo prefix.
fn redact_unresolved_uri_authority(
    value: &mut String,
    visible_end: &mut usize,
    has_unscanned_tail: bool,
    accounting: &mut SupportScrubAccounting,
) -> Result<bool, SupportScrubError> {
    if !has_unscanned_tail {
        return Ok(false);
    }
    let mut unresolved = None;
    for scheme in uri_scheme_regex().find_iter(value) {
        if scheme.start() >= *visible_end {
            break;
        }
        let authority = &value[scheme.end()..];
        if authority
            .bytes()
            .any(|byte| byte.is_ascii_whitespace() || matches!(byte, b'/' | b'?' | b'#'))
            || authority.contains('@')
        {
            continue;
        }
        unresolved = Some(scheme.start());
        break;
    }
    let Some(start) = unresolved else {
        return Ok(false);
    };

    let marker = redaction_marker(SupportSecretClassV1::UrlUserinfo);
    let mut output = String::with_capacity(start + marker.len());
    output.push_str(&value[..start]);
    output.push_str(marker);
    *value = output;
    *visible_end = value.len();
    accounting.record_secret(SupportSecretClassV1::UrlUserinfo, 1)?;
    Ok(true)
}

fn replace_with_prefix(
    value: &mut String,
    visible_end: &mut usize,
    regex: &Regex,
    class: SupportSecretClassV1,
    accounting: &mut SupportScrubAccounting,
) -> Result<bool, SupportScrubError> {
    let marker = redaction_marker(class);
    let count = replace_captures(value, visible_end, regex, |captures| {
        let prefix = captures
            .name("prefix")
            .map_or("", |capture| capture.as_str());
        let matched = captures.get(0).expect("regex capture zero");
        let value_offset = captures
            .name("prefix")
            .map_or(0, |capture| capture.end() - matched.start());
        (!matched.as_str()[value_offset..].starts_with("[REDACTED:"))
            .then(|| format!("{prefix}{marker}"))
    })?;
    if count == 0 {
        return Ok(false);
    }
    accounting.record_secret(class, count)?;
    Ok(true)
}

fn replace_direct(
    value: &mut String,
    visible_end: &mut usize,
    regex: &Regex,
    class: SupportSecretClassV1,
    accounting: &mut SupportScrubAccounting,
) -> Result<bool, SupportScrubError> {
    let marker = redaction_marker(class);
    let count = replace_captures(value, visible_end, regex, |_| Some(marker.to_owned()))?;
    if count == 0 {
        return Ok(false);
    }
    accounting.record_secret(class, count)?;
    Ok(true)
}

fn replace_userinfo(
    value: &mut String,
    visible_end: &mut usize,
    accounting: &mut SupportScrubAccounting,
) -> Result<bool, SupportScrubError> {
    let source_visible_end = *visible_end;
    let count = replace_captures(value, visible_end, url_userinfo_regex(), |captures| {
        let scheme = captures.name("scheme").map_or("", |capture| {
            visible_capture_prefix(capture, source_visible_end)
        });
        let host = captures.name("host").map_or("", |capture| {
            visible_capture_prefix(capture, source_visible_end)
        });
        Some(format!("{scheme}{host}"))
    })?;
    if count == 0 {
        return Ok(false);
    }
    accounting.record_secret(SupportSecretClassV1::UrlUserinfo, count)?;
    Ok(true)
}

fn visible_capture_prefix<'a>(capture: regex::Match<'a>, visible_end: usize) -> &'a str {
    let retained = visible_end
        .saturating_sub(capture.start())
        .min(capture.as_str().len());
    &capture.as_str()[..retained]
}

fn replace_captures<F>(
    value: &mut String,
    visible_end: &mut usize,
    regex: &Regex,
    mut replacement: F,
) -> Result<u64, SupportScrubError>
where
    F: FnMut(&Captures<'_>) -> Option<String>,
{
    let old_visible_end = (*visible_end).min(value.len());
    let mut output = String::with_capacity(value.len());
    let mut prior = 0;
    let mut mapped_visible_end = None;
    let mut count = 0_usize;
    for captures in regex.captures_iter(value) {
        let matched = captures.get(0).expect("regex capture zero");
        if matched.start() >= old_visible_end {
            break;
        }
        let Some(replacement) = replacement(&captures) else {
            continue;
        };
        output.push_str(&value[prior..matched.start()]);
        output.push_str(&replacement);
        prior = matched.end();
        count += 1;
        if matched.end() >= old_visible_end {
            mapped_visible_end = Some(output.len());
            break;
        }
    }
    if count == 0 {
        return Ok(0);
    }
    let mapped_visible_end = mapped_visible_end.unwrap_or_else(|| {
        output.push_str(&value[prior..old_visible_end]);
        output.len()
    });
    let suffix_start = prior.max(old_visible_end);
    output.push_str(&value[suffix_start..]);
    *value = output;
    *visible_end = mapped_visible_end;
    u64::try_from(count).map_err(|_| SupportScrubError::AccountingOverflow)
}

fn replace_high_confidence_opaque(
    value: &mut String,
    visible_end: &mut usize,
    accounting: &mut SupportScrubAccounting,
) -> Result<bool, SupportScrubError> {
    let old_visible_end = (*visible_end).min(value.len());
    let mut output = String::with_capacity(value.len());
    let mut prior = 0;
    let mut mapped_visible_end = None;
    let mut count = 0_u64;
    let bytes = value.as_bytes();
    let mut matches = Vec::new();
    let mut start = 0;
    while start < bytes.len() {
        if start >= old_visible_end {
            break;
        }
        if !opaque_byte(bytes[start]) {
            start += 1;
            continue;
        }
        let mut end = start + 1;
        while end < bytes.len() && opaque_byte(bytes[end]) {
            end += 1;
        }
        if approved_opaque_context(value, start, end) {
            collect_contextual_opaque_matches(value, start, end, &mut matches);
        } else if end - start >= 48 && is_high_confidence_opaque(&value[start..end]) {
            matches.push((start, end));
        }
        start = end;
    }
    for (start, end) in matches {
        if start >= old_visible_end {
            break;
        }
        output.push_str(&value[prior..start]);
        output.push_str(redaction_marker(SupportSecretClassV1::OpaqueCredential));
        prior = end;
        count = count
            .checked_add(1)
            .ok_or(SupportScrubError::AccountingOverflow)?;
        if end >= old_visible_end {
            mapped_visible_end = Some(output.len());
            break;
        }
    }
    if count == 0 {
        return Ok(false);
    }
    let mapped_visible_end = mapped_visible_end.unwrap_or_else(|| {
        output.push_str(&value[prior..old_visible_end]);
        output.len()
    });
    let suffix_start = prior.max(old_visible_end);
    output.push_str(&value[suffix_start..]);
    accounting.record_secret(SupportSecretClassV1::OpaqueCredential, count)?;
    *value = output;
    *visible_end = mapped_visible_end;
    Ok(true)
}

fn collect_contextual_opaque_matches(
    value: &str,
    start: usize,
    end: usize,
    matches: &mut Vec<(usize, usize)>,
) {
    match classify_contextual_run(value, start, end) {
        ContextualRun::QueryKey => {}
        ContextualRun::QueryValue { candidate_start } => {
            collect_opaque_candidate(value, candidate_start, end, matches);
        }
        ContextualRun::Path { candidate_start } => {
            let bytes = value.as_bytes();
            let mut segment_start = candidate_start;
            for (boundary, byte) in bytes.iter().enumerate().take(end).skip(candidate_start) {
                if *byte != b'/' {
                    continue;
                }
                collect_opaque_candidate(value, segment_start, boundary, matches);
                segment_start = boundary.saturating_add(1);
            }
            // The run's end is always a boundary, exactly as the inclusive
            // index loop treated `boundary == end`.
            collect_opaque_candidate(value, segment_start, end, matches);
        }
    }
}

enum ContextualRun {
    QueryKey,
    QueryValue { candidate_start: usize },
    Path { candidate_start: usize },
}

fn classify_contextual_run(value: &str, start: usize, end: usize) -> ContextualRun {
    let token_start = contextual_token_start(value, start);
    let query_opener = value[token_start..start]
        .rfind(['?', '#'])
        .map(|boundary| token_start + boundary);
    let Some(query_opener) = query_opener else {
        return ContextualRun::Path {
            candidate_start: contextual_path_value_start(value, token_start, start, end),
        };
    };
    let parameter_start = value[query_opener + 1..start]
        .rfind('&')
        .map_or(query_opener + 1, |boundary| query_opener + boundary + 2);
    let Some(delimiter) = value[parameter_start..end].find('=') else {
        return ContextualRun::QueryKey;
    };
    let delimiter = parameter_start + delimiter;
    ContextualRun::QueryValue {
        candidate_start: if delimiter < start {
            start
        } else {
            delimiter + 1
        },
    }
}

fn contextual_path_value_start(value: &str, token_start: usize, start: usize, end: usize) -> usize {
    let Some(delimiter) = value[start..end].find('=') else {
        return start;
    };
    let delimiter = start + delimiter;
    let label = value[token_start..delimiter].to_ascii_lowercase();
    if matches!(
        label.as_str(),
        "path" | "file" | "filename" | "directory" | "repo" | "repository" | "relative"
    ) {
        delimiter + 1
    } else {
        start
    }
}

fn collect_opaque_candidate(
    value: &str,
    start: usize,
    end: usize,
    matches: &mut Vec<(usize, usize)>,
) {
    if end.saturating_sub(start) >= 48 && is_high_confidence_opaque(&value[start..end]) {
        matches.push((start, end));
    }
}

fn opaque_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'+' | b'/' | b'=' | b'-')
}

/// Two character classes, not three.
///
/// A single-alphabet secret is still a secret: a bare lowercase hex token
/// carries only lowercase and digits, so a three-class floor exempted every
/// hex credential at every length, which the superseded `{48,}` rule redacted.
/// The distinct-byte floor is what separates a credential from padding: a
/// random token over any realistic alphabet exceeds ten distinct bytes long
/// before it reaches forty-eight, while a repeated-character run and a long
/// single-alphabet word do not clear both floors together.
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
    classes >= 2 && distinct >= 10
}

fn approved_opaque_context(value: &str, start: usize, end: usize) -> bool {
    let token_start = contextual_token_start(value, start);
    let token_end = value[end..]
        .find(opaque_context_boundary)
        .map_or(value.len(), |boundary| end + boundary);
    let token = &value[token_start..token_end];
    if uri_scheme_regex().is_match(token) {
        return true;
    }
    let labeled_path = token.split_once('=').is_some_and(|(label, value)| {
        matches!(
            label.to_ascii_lowercase().as_str(),
            "path" | "file" | "filename" | "directory" | "repo" | "repository" | "relative"
        ) && value.contains('/')
    });
    labeled_path
        || token.starts_with('/')
        || token.starts_with("~/")
        || token.starts_with("./")
        || token.starts_with("../")
        || token.contains('\\')
        || (token.contains('/') && !token.contains('='))
}

fn contextual_token_start(value: &str, before: usize) -> usize {
    value[..before]
        .char_indices()
        .rev()
        .find_map(|(boundary, character)| {
            opaque_context_boundary(character).then_some(boundary + character.len_utf8())
        })
        .unwrap_or(0)
}

fn opaque_context_boundary(character: char) -> bool {
    character.is_whitespace()
        || matches!(
            character,
            '"' | '\'' | '`' | '<' | '>' | '{' | '}' | '[' | ']' | '(' | ')' | ',' | ';'
        )
}

fn uri_scheme_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| Regex::new(r"(?i)\b[a-z][a-z0-9+.-]*://").expect("fixed URI-scheme regex"))
}

fn url_userinfo_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r"(?i)\b(?P<scheme>[a-z][a-z0-9+.-]*://)[^\s/?#]+@(?P<host>[^\s/?#@]*)")
            .expect("fixed URL-userinfo regex")
    })
}

fn signed_url_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(
            r"(?i)(?P<prefix>[?&#](?:x-amz-signature|x-amz-credential|x-amz-security-token|x-goog-signature|x-goog-credential|x-goog-security-token|signature|sig|security-token|security_token|credential|authorization|access_token|refresh_token|identity_token|id_token|api_key|client_secret|password|token)=)[^&#\s]+",
        )
        .expect("fixed signed-URL regex")
    })
}

fn authorization_label_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(
            r#"(?im)(?P<prefix>(?:^|[\s{\[(,;])["']?(?:authorization|proxy[-_ ]?authorization|auth[-_ ]?header)(?:[-_ ]?(?:length|prefix|suffix|hash|sha(?:256)?|checksum|digest|fingerprint))*["']?\s*[:=]\s*)(?:bearer\s+|basic\s+)?(?:"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?|[^\r\n]+)"#,
        )
        .expect("fixed authorization-label regex")
    })
}

fn cookie_label_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(
            r#"(?im)(?P<prefix>(?:^|[\s{\[(,;])["']?(?:cookie|set[-_ ]?cookie)(?:[-_ ]?(?:length|prefix|suffix|hash|sha(?:256)?|checksum|digest|fingerprint))*["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?|[^\r\n]+)"#,
        )
        .expect("fixed cookie-label regex")
    })
}

fn labeled_secret_regexes() -> &'static [(Regex, SupportSecretClassV1)] {
    static REGEXES: OnceLock<Vec<(Regex, SupportSecretClassV1)>> = OnceLock::new();
    REGEXES.get_or_init(|| {
        [
            (
                r#"(?im)(?P<prefix>(?:^|[\s{\[(,;])["']?(?:access[-_ ]?token|bearer[-_ ]?token|raw[-_ ]?token|session[-_ ]?token|security[-_ ]?token)(?:[-_ ]?(?:length|prefix|suffix|hash|sha(?:256)?|checksum|digest|fingerprint))*["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?|[^\s,;}\]\)&]+)"#,
                SupportSecretClassV1::AccessToken,
            ),
            (
                r#"(?im)(?P<prefix>(?:^|[\s{\[(,;])["']?refresh[-_ ]?token(?:[-_ ]?(?:length|prefix|suffix|hash|sha(?:256)?|checksum|digest|fingerprint))*["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?|[^\s,;}\]\)&]+)"#,
                SupportSecretClassV1::RefreshToken,
            ),
            (
                r#"(?im)(?P<prefix>(?:^|[\s{\[(,;])["']?(?:identity[-_ ]?token|id[-_ ]?token)(?:[-_ ]?(?:length|prefix|suffix|hash|sha(?:256)?|checksum|digest|fingerprint))*["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?|[^\s,;}\]\)&]+)"#,
                SupportSecretClassV1::IdentityToken,
            ),
            (
                r#"(?im)(?P<prefix>(?:^|[\s{\[(,;])["']?(?:api[-_ ]?key|x[-_ ]?api[-_ ]?key|secret[-_ ]?key)(?:[-_ ]?(?:length|prefix|suffix|hash|sha(?:256)?|checksum|digest|fingerprint))*["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?|[^\s,;}\]\)&]+)"#,
                SupportSecretClassV1::ApiKey,
            ),
            (
                r#"(?im)(?P<prefix>(?:^|[\s{\[(,;])["']?client[-_ ]?secret(?:[-_ ]?(?:length|prefix|suffix|hash|sha(?:256)?|checksum|digest|fingerprint))*["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?|[^\s,;}\]\)&]+)"#,
                SupportSecretClassV1::ClientSecret,
            ),
            (
                r#"(?im)(?P<prefix>(?:^|[\s{\[(,;])["']?(?:password|passphrase)(?:[-_ ]?(?:length|prefix|suffix|hash|sha(?:256)?|checksum|digest|fingerprint))*["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?|[^\s,;}\]\)&]+)"#,
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

/// A qualifier may be joined to the secret word by `_`, by `-`, or by nothing
/// at all: `authToken` and `auth-token` name the same secret as
/// `AUTH_TOKEN`. The unseparated form is matched case-sensitively, because
/// only a case transition distinguishes `authToken` from `monkey` -- an
/// unseparated case-insensitive qualifier would redact any word ending in a
/// secret word. A space is deliberately not a qualifier separator: `pass:` and
/// `secret:` already reach ordinary prose without one.
fn environment_assignment_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(
            r#"(?im)(?P<prefix>(?:^|[\s{\[(,;])["']?(?:(?:[a-z][a-z0-9]*[-_])*(?:token|key|secret|password|pass|credential)|(?-i:[A-Za-z][a-z0-9]*(?:Token|Key|Secret|Password|Pass|Credential)))(?:[-_ ]?(?:length|prefix|suffix|hash|sha(?:256)?|checksum|digest|fingerprint))*["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?|[^\s,;}\]\)&]+)"#,
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
            r"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9_-]{16,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}|(?:AKIA|ASIA)[A-Z0-9]{16})\b",
        )
        .expect("fixed provider-credential regex")
    })
}

/// `Digest` and `token` are ordinary English words as well as HTTP
/// authentication schemes, so they carry a credential-shaped operand floor
/// that `bearer` and `basic` do not need. Twenty bytes is longer than the
/// prose that follows either word and shorter than every scheme credential.
fn authorization_scheme_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(
            r"(?i)\b(?:(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{4,}|(?:digest|token)\s+[A-Za-z0-9._~+/=-]{20,})",
        )
        .expect("fixed authorization-scheme regex")
    })
}
