use serde::Serialize;

use super::super::schema::enums::{
    SupportEvidenceSourceV1, SupportOmissionReasonV1, SupportSecretClassV1,
    SupportTruncationReasonV1,
};
use super::super::schema::model::common::{SupportOmissionV1, SupportTruncationV1};
use super::super::schema::model::manifest::SupportSecretScrubCountsV1;
use super::SupportScrubError;

/// Exact accounting emitted by the pure scrub pass.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupportScrubAccounting {
    pub scrubbed_by_class: SupportSecretScrubCountsV1,
    pub truncations: Vec<SupportTruncationV1>,
    pub omissions: Vec<SupportOmissionV1>,
}

impl SupportScrubAccounting {
    pub(super) fn record_secret(
        &mut self,
        class: SupportSecretClassV1,
        count: u64,
    ) -> Result<(), SupportScrubError> {
        let counter = match class {
            SupportSecretClassV1::Authorization => &mut self.scrubbed_by_class.authorization,
            SupportSecretClassV1::Cookie => &mut self.scrubbed_by_class.cookie,
            SupportSecretClassV1::AccessToken => &mut self.scrubbed_by_class.access_token,
            SupportSecretClassV1::RefreshToken => &mut self.scrubbed_by_class.refresh_token,
            SupportSecretClassV1::IdentityToken => &mut self.scrubbed_by_class.identity_token,
            SupportSecretClassV1::ApiKey => &mut self.scrubbed_by_class.api_key,
            SupportSecretClassV1::ClientSecret => &mut self.scrubbed_by_class.client_secret,
            SupportSecretClassV1::Password => &mut self.scrubbed_by_class.password,
            SupportSecretClassV1::PrivateKey => &mut self.scrubbed_by_class.private_key,
            SupportSecretClassV1::CredentialContainer => {
                &mut self.scrubbed_by_class.credential_container
            }
            SupportSecretClassV1::EnvironmentSecret => {
                &mut self.scrubbed_by_class.environment_secret
            }
            SupportSecretClassV1::SignedUrl => &mut self.scrubbed_by_class.signed_url,
            SupportSecretClassV1::ProviderCredential => {
                &mut self.scrubbed_by_class.provider_credential
            }
            SupportSecretClassV1::OpaqueCredential => &mut self.scrubbed_by_class.opaque_credential,
            SupportSecretClassV1::UrlUserinfo => &mut self.scrubbed_by_class.url_userinfo,
        };
        *counter = counter
            .checked_add(count)
            .ok_or(SupportScrubError::AccountingOverflow)?;
        Ok(())
    }

    pub(super) fn record_truncation(
        &mut self,
        source: SupportEvidenceSourceV1,
        reason: SupportTruncationReasonV1,
        count: u64,
        omitted_bytes: Option<u64>,
    ) -> Result<(), SupportScrubError> {
        if let Some(entry) = self
            .truncations
            .iter_mut()
            .find(|entry| entry.source == source && entry.reason == reason)
        {
            entry.count = entry
                .count
                .checked_add(count)
                .ok_or(SupportScrubError::AccountingOverflow)?;
            entry.omitted_bytes = match (entry.omitted_bytes, omitted_bytes) {
                (Some(left), Some(right)) => Some(
                    left.checked_add(right)
                        .ok_or(SupportScrubError::AccountingOverflow)?,
                ),
                _ => None,
            };
        } else {
            self.truncations.push(SupportTruncationV1 {
                source,
                reason,
                count,
                omitted_bytes,
            });
            self.truncations
                .sort_by_key(|entry| (entry.source, entry.reason));
        }
        Ok(())
    }

    pub(super) fn record_omission(
        &mut self,
        source: SupportEvidenceSourceV1,
        reason: SupportOmissionReasonV1,
        count: u64,
        known_bytes: Option<u64>,
    ) -> Result<(), SupportScrubError> {
        if let Some(entry) = self
            .omissions
            .iter_mut()
            .find(|entry| entry.source == source && entry.reason == reason)
        {
            entry.count = entry
                .count
                .checked_add(count)
                .ok_or(SupportScrubError::AccountingOverflow)?;
            entry.known_bytes = match (entry.known_bytes, known_bytes) {
                (Some(left), Some(right)) => Some(
                    left.checked_add(right)
                        .ok_or(SupportScrubError::AccountingOverflow)?,
                ),
                _ => None,
            };
        } else {
            self.omissions.push(SupportOmissionV1 {
                source,
                reason,
                count,
                known_bytes,
            });
            self.omissions
                .sort_by_key(|entry| (entry.source, entry.reason));
        }
        Ok(())
    }
}

pub(super) fn redaction_marker(class: SupportSecretClassV1) -> &'static str {
    match class {
        SupportSecretClassV1::Authorization => "[REDACTED:authorization]",
        SupportSecretClassV1::Cookie => "[REDACTED:cookie]",
        SupportSecretClassV1::AccessToken => "[REDACTED:access_token]",
        SupportSecretClassV1::RefreshToken => "[REDACTED:refresh_token]",
        SupportSecretClassV1::IdentityToken => "[REDACTED:identity_token]",
        SupportSecretClassV1::ApiKey => "[REDACTED:api_key]",
        SupportSecretClassV1::ClientSecret => "[REDACTED:client_secret]",
        SupportSecretClassV1::Password => "[REDACTED:password]",
        SupportSecretClassV1::PrivateKey => "[REDACTED:private_key]",
        SupportSecretClassV1::CredentialContainer => "[REDACTED:credential_container]",
        SupportSecretClassV1::EnvironmentSecret => "[REDACTED:environment_secret]",
        SupportSecretClassV1::SignedUrl => "[REDACTED:signed_url]",
        SupportSecretClassV1::ProviderCredential => "[REDACTED:provider_credential]",
        SupportSecretClassV1::OpaqueCredential => "[REDACTED:opaque_credential]",
        SupportSecretClassV1::UrlUserinfo => "[REDACTED:url_userinfo]",
    }
}
