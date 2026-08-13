use super::super::schema::enums::{
    SupportEvidenceSourceV1, SupportOmissionReasonV1, SupportSecretClassV1,
    SupportTruncationReasonV1,
};
use super::super::schema::limits::{CONTAINER_ITEMS, GENERIC_STRING_BYTES, NESTING_DEPTH};
use super::super::schema::model::common::SupportJsonValueV1;
use super::super::schema::validate::{validate_safe_i64, validate_support_number};
use super::accounting::{redaction_marker, SupportScrubAccounting};
use super::text::{to_u64, TextRole};
use super::{SupportExportScrubber, SupportOptionalScrubbed, SupportScrubError, SupportScrubbed};

pub(super) fn scrub_mandatory(
    scrubber: &SupportExportScrubber,
    value: SupportJsonValueV1,
    source: SupportEvidenceSourceV1,
) -> Result<SupportScrubbed<SupportJsonValueV1>, SupportScrubError> {
    let mut accounting = SupportScrubAccounting::default();
    let value = scrubber
        .scrub_value_at(value, TextRole::Generic, 0, source, &mut accounting)?
        .ok_or(SupportScrubError::InvalidValue)?;
    Ok(SupportScrubbed { value, accounting })
}

pub(super) fn scrub_optional(
    scrubber: &SupportExportScrubber,
    value: SupportJsonValueV1,
    source: SupportEvidenceSourceV1,
) -> Result<SupportOptionalScrubbed<SupportJsonValueV1>, SupportScrubError> {
    let mut accounting = SupportScrubAccounting::default();
    let value = match scrubber.scrub_value_at(value, TextRole::Generic, 0, source, &mut accounting)
    {
        Ok(value) => value,
        Err(SupportScrubError::TraversalLimit | SupportScrubError::InvalidValue) => {
            accounting.record_omission(source, SupportOmissionReasonV1::SourceInvalid, 1, None)?;
            None
        }
        Err(error) => return Err(error),
    };
    Ok(SupportOptionalScrubbed { value, accounting })
}

impl SupportExportScrubber {
    pub(super) fn scrub_value_at(
        &self,
        value: SupportJsonValueV1,
        role: TextRole,
        depth: usize,
        source: SupportEvidenceSourceV1,
        accounting: &mut SupportScrubAccounting,
    ) -> Result<Option<SupportJsonValueV1>, SupportScrubError> {
        if depth > NESTING_DEPTH {
            return Err(SupportScrubError::TraversalLimit);
        }
        match value {
            SupportJsonValueV1::Null => Ok(Some(SupportJsonValueV1::Null)),
            SupportJsonValueV1::Bool(value) => Ok(Some(SupportJsonValueV1::Bool(value))),
            SupportJsonValueV1::Integer(value) => {
                validate_safe_i64(value).map_err(|_| SupportScrubError::InvalidValue)?;
                Ok(Some(SupportJsonValueV1::Integer(value)))
            }
            SupportJsonValueV1::Number(value) => {
                validate_support_number(value).map_err(|_| SupportScrubError::InvalidValue)?;
                Ok(Some(SupportJsonValueV1::Number(value)))
            }
            SupportJsonValueV1::String(value) => self
                .scrub_text_into(&value, value.len(), role, source, accounting)
                .map(|value| value.map(SupportJsonValueV1::String)),
            SupportJsonValueV1::Array(values) => {
                let omitted = values.len().saturating_sub(CONTAINER_ITEMS);
                if omitted > 0 {
                    accounting.record_truncation(
                        source,
                        SupportTruncationReasonV1::ContainerItems,
                        to_u64(omitted)?,
                        None,
                    )?;
                }
                let mut scrubbed = Vec::with_capacity(values.len().min(CONTAINER_ITEMS));
                for value in values.into_iter().take(CONTAINER_ITEMS) {
                    if let Some(value) =
                        self.scrub_value_at(value, role, depth + 1, source, accounting)?
                    {
                        scrubbed.push(value);
                    }
                }
                Ok(Some(SupportJsonValueV1::Array(scrubbed)))
            }
            SupportJsonValueV1::Object(mut entries) => {
                let omitted = entries.len().saturating_sub(CONTAINER_ITEMS);
                if omitted > 0 {
                    accounting.record_truncation(
                        source,
                        SupportTruncationReasonV1::ContainerItems,
                        to_u64(omitted)?,
                        None,
                    )?;
                    let boundary_duplicate = {
                        let (retained, next, _) = entries
                            .select_nth_unstable_by(CONTAINER_ITEMS, |left, right| {
                                left.0.chars().cmp(right.0.chars())
                            });
                        retained
                            .iter()
                            .any(|entry| entry.0.as_str() == next.0.as_str())
                    };
                    if boundary_duplicate {
                        return Err(SupportScrubError::InvalidValue);
                    }
                    entries.truncate(CONTAINER_ITEMS);
                }
                entries.sort_by(|left, right| left.0.chars().cmp(right.0.chars()));
                let mut scrubbed = Vec::with_capacity(entries.len().min(CONTAINER_ITEMS));
                for (key, value) in entries {
                    if key.len() > GENERIC_STRING_BYTES {
                        accounting.record_omission(
                            source,
                            SupportOmissionReasonV1::SourceCap,
                            1,
                            Some(to_u64(key.len())?),
                        )?;
                        continue;
                    }
                    let normalized = normalize_key(&key);
                    let key_class = secret_key_class(&key, &normalized);
                    if let Some(class) = key_class {
                        accounting.record_secret(class, 1)?;
                        scrubbed.push((
                            key,
                            SupportJsonValueV1::String(redaction_marker(class).to_owned()),
                        ));
                        continue;
                    }
                    let Some(key) = self.scrub_text_into(
                        &key,
                        key.len(),
                        TextRole::Generic,
                        source,
                        accounting,
                    )?
                    else {
                        continue;
                    };
                    let child_role = role_for_key(&normalized);
                    if let Some(value) =
                        self.scrub_value_at(value, child_role, depth + 1, source, accounting)?
                    {
                        scrubbed.push((key, value));
                    }
                }
                scrubbed.sort_by(|left, right| left.0.chars().cmp(right.0.chars()));
                if scrubbed.windows(2).any(|pair| pair[0].0 == pair[1].0) {
                    return Err(SupportScrubError::InvalidValue);
                }
                Ok(Some(SupportJsonValueV1::Object(scrubbed)))
            }
        }
    }
}

pub(super) fn normalize_key(key: &str) -> String {
    key.chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .map(|character| character.to_ascii_lowercase())
        .collect()
}

/// Words that name metadata derived from a secret rather than a field of its
/// own. `access_token_hash` is still the access token's field.
const DERIVED_WORDS: [&str; 9] = [
    "length",
    "prefix",
    "suffix",
    "sha256",
    "checksum",
    "fingerprint",
    "digest",
    "hash",
    "sha",
];

/// Classify one key as a secret field.
///
/// The exact normalized list runs first and keeps its precise classes. A key
/// the list does not name is then read as words and classified by its final
/// word, which is what reaches `authToken`, `apiToken`, `webhookSecret`,
/// `userPassword`, and `deviceToken` without admitting the substring
/// collisions the exact list exists to avoid: `monkey`, `credentialed`, and
/// `token_count` all end in a word that names nothing.
pub(super) fn secret_key_class(key: &str, normalized: &str) -> Option<SupportSecretClassV1> {
    exact_secret_key_class(normalized).or_else(|| qualified_secret_key_class(key))
}

fn exact_secret_key_class(normalized: &str) -> Option<SupportSecretClassV1> {
    let mut candidate = normalized;
    'derived: loop {
        if let Some(class) = direct_secret_key_class(candidate) {
            return Some(class);
        }
        for suffix in DERIVED_WORDS {
            if let Some(base) = candidate.strip_suffix(suffix) {
                candidate = base;
                continue 'derived;
            }
        }
        return None;
    }
}

/// Classify a qualified key by its final word. Only the words that name a
/// credential unambiguously keep a precise class; the rest land in the
/// deliberately unnamed opaque bucket rather than claiming a classification
/// the key does not support.
fn qualified_secret_key_class(key: &str) -> Option<SupportSecretClassV1> {
    let words = key_words(key);
    let mut qualified = words.as_slice();
    while let Some((last, rest)) = qualified.split_last() {
        if DERIVED_WORDS.contains(&last.as_str()) {
            qualified = rest;
        } else {
            break;
        }
    }
    let (last, qualifier) = qualified.split_last()?;
    // A bare secret word is the exact list's territory. Admitting it here
    // would redact ordinary single-word fields such as `key` or `pass`.
    if qualifier.is_empty() {
        return None;
    }
    let class = match last.as_str() {
        "password" | "passphrase" => SupportSecretClassV1::Password,
        "cookie" => SupportSecretClassV1::Cookie,
        "authorization" => SupportSecretClassV1::Authorization,
        "token" | "secret" | "credential" | "key" => SupportSecretClassV1::OpaqueCredential,
        _ => return None,
    };
    Some(class)
}

/// Split one key into lowercase words on separators and on the lower-to-upper
/// transition that makes `authToken` two words and `monkey` one.
fn key_words(key: &str) -> Vec<String> {
    let mut words = Vec::new();
    let mut current = String::new();
    let mut previous_was_lower = false;
    for character in key.chars() {
        if !character.is_ascii_alphanumeric() {
            if !current.is_empty() {
                words.push(std::mem::take(&mut current));
            }
            previous_was_lower = false;
            continue;
        }
        if previous_was_lower && character.is_ascii_uppercase() && !current.is_empty() {
            words.push(std::mem::take(&mut current));
        }
        previous_was_lower = character.is_ascii_lowercase() || character.is_ascii_digit();
        current.push(character.to_ascii_lowercase());
    }
    if !current.is_empty() {
        words.push(current);
    }
    words
}

fn direct_secret_key_class(normalized: &str) -> Option<SupportSecretClassV1> {
    let class = match normalized {
        "authorization"
        | "authorizationheader"
        | "authheader"
        | "proxyauthorization"
        | "proxyauthorizationheader"
        | "supportauthorizationid"
        | "supportpermitid" => SupportSecretClassV1::Authorization,
        "cookie" | "cookies" | "cookieheader" | "setcookie" => SupportSecretClassV1::Cookie,
        "accesstoken" | "bearertoken" | "rawtoken" | "sessiontoken" | "securitytoken" => {
            SupportSecretClassV1::AccessToken
        }
        "refreshtoken" => SupportSecretClassV1::RefreshToken,
        "identitytoken" | "idtoken" => SupportSecretClassV1::IdentityToken,
        "apikey" | "xapikey" | "secretkey" => SupportSecretClassV1::ApiKey,
        "clientsecret" => SupportSecretClassV1::ClientSecret,
        "password" | "passphrase" => SupportSecretClassV1::Password,
        "privatekey" | "signingkey" => SupportSecretClassV1::PrivateKey,
        "credentials"
        | "credentialcontainer"
        | "credentialstore"
        | "keychain"
        | "keychainitem"
        | "keychainitems"
        | "credentialmaterial" => SupportSecretClassV1::CredentialContainer,
        "environment" | "environmentmap" | "environmentvalues" | "env" | "envmap" | "envvars"
        | "envvalues" | "rawenv" | "rawenvironment" | "secretenvironment" => {
            SupportSecretClassV1::EnvironmentSecret
        }
        "githubtoken" | "gitlabtoken" | "slacktoken" | "awsaccesskeyid" | "awssecretaccesskey"
        | "awssessiontoken" | "awssecuritytoken" | "providertoken" | "providercredential" => {
            SupportSecretClassV1::ProviderCredential
        }
        "signedurl" | "presignedurl" | "presigneduploadurl" => SupportSecretClassV1::SignedUrl,
        "secret" | "secretvalue" | "secrets" | "credential" | "token" => {
            SupportSecretClassV1::OpaqueCredential
        }
        "urluserinfo" => SupportSecretClassV1::UrlUserinfo,
        _ => return None,
    };
    Some(class)
}

pub(super) fn role_for_key(normalized: &str) -> TextRole {
    if matches!(
        normalized,
        "prompt"
            | "transcript"
            | "message"
            | "text"
            | "content"
            | "body"
            | "response"
            | "error"
            | "providerresponse"
            | "providererror"
            | "toolinput"
            | "tooloutput"
            | "toolresult"
            | "terminal"
            | "terminaloutput"
            | "stdout"
            | "stderr"
            | "file"
            | "filecontent"
            | "path"
            | "repository"
            | "reponame"
            | "url"
            | "payload"
            | "rawnotification"
    ) {
        TextRole::Content
    } else if matches!(
        normalized,
        "operationid"
            | "parentoperationid"
            | "traceid"
            | "workspaceid"
            | "sessionid"
            | "turnid"
            | "itemid"
            | "requestid"
            | "targetid"
            | "promptid"
            | "workflowid"
            | "producerbootid"
            | "collectorbootid"
            | "snapshotid"
            | "materializedsessionid"
            | "uisessionid"
            | "anyharnessworkspaceid"
            | "acceptedid"
            | "modelid"
            | "pluginid"
            | "uuid"
    ) {
        TextRole::Identifier
    } else if matches!(
        normalized,
        "timestamp"
            | "sourcetimestamp"
            | "acceptedtimestamp"
            | "capturedat"
            | "generatedat"
            | "reportopenedat"
            | "sourcetimefrom"
            | "sourcetimeto"
            | "summarycapturedat"
            | "grantedat"
            | "updatedat"
    ) {
        TextRole::Timestamp
    } else if matches!(
        normalized,
        "hash"
            | "sha"
            | "sha256"
            | "checksum"
            | "commit"
            | "commitsha"
            | "gitcommit"
            | "contenthash"
    ) {
        TextRole::Hash
    } else if matches!(
        normalized,
        "name"
            | "kind"
            | "provider"
            | "providerkind"
            | "model"
            | "plugin"
            | "release"
            | "version"
            | "runtimeversion"
            | "runtimestatus"
            | "status"
            | "type"
    ) {
        TextRole::Name
    } else {
        TextRole::Generic
    }
}
