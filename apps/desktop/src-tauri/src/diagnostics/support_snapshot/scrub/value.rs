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
                    if let Some(class) = secret_key_class(&normalized) {
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

pub(super) fn secret_key_class(normalized: &str) -> Option<SupportSecretClassV1> {
    if let Some(class) = direct_secret_key_class(normalized) {
        return Some(class);
    }
    for derived in [
        "length",
        "prefix",
        "suffix",
        "hash",
        "sha",
        "sha256",
        "checksum",
        "digest",
        "fingerprint",
    ] {
        if let Some(secret_base) = normalized.strip_suffix(derived) {
            if let Some(class) = direct_secret_key_class(secret_base) {
                return Some(class);
            }
        }
    }
    None
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
        "accesstoken" | "bearertoken" | "rawtoken" => SupportSecretClassV1::AccessToken,
        "refreshtoken" => SupportSecretClassV1::RefreshToken,
        "identitytoken" | "idtoken" => SupportSecretClassV1::IdentityToken,
        "apikey" | "xapikey" => SupportSecretClassV1::ApiKey,
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
