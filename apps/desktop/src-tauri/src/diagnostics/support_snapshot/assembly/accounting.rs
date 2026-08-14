//! Checked fixed-order manifest and source accounting.

use std::collections::BTreeMap;

use super::super::schema::enums::{
    SupportEvidenceSourceV1, SupportOmissionReasonV1, SupportSecretClassV1,
    SupportSourceManifestSourceV1, SupportSourceStateV1, SupportTruncationReasonV1,
};
use super::super::schema::limits::{MAX_OMISSION_ENTRIES, MAX_TRUNCATION_ENTRIES};
use super::super::schema::model::common::{SupportOmissionV1, SupportTruncationV1};
use super::super::schema::model::manifest::{
    SupportAdditionalEntriesV1, SupportSecretScrubCountsV1, SupportSourceManifestV1,
};
use super::super::scrub::SupportScrubAccounting;
use super::input::{SupportAssemblyError, SupportSourceCaptureV1};

#[derive(Debug, Clone)]
struct OmissionCount {
    count: u64,
    known_bytes: Option<u64>,
}

#[derive(Debug, Clone)]
struct TruncationCount {
    count: u64,
    omitted_bytes: Option<u64>,
}

#[derive(Debug, Clone, Default)]
pub(super) struct AssemblyAccounting {
    scrubbed: SupportSecretScrubCountsV1,
    omissions: BTreeMap<(SupportEvidenceSourceV1, SupportOmissionReasonV1), OmissionCount>,
    truncations: BTreeMap<(SupportEvidenceSourceV1, SupportTruncationReasonV1), TruncationCount>,
    pub(super) removed_by_tier: [u64; 8],
}

impl AssemblyAccounting {
    pub(super) fn absorb_scrub(
        &mut self,
        accounting: &SupportScrubAccounting,
    ) -> Result<(), SupportAssemblyError> {
        for class in secret_classes() {
            self.add_secret(class, accounting.scrubbed_by_class.get(class))?;
        }
        for omission in &accounting.omissions {
            self.add_omission(
                omission.source,
                omission.reason,
                omission.count,
                omission.known_bytes,
            )?;
        }
        for truncation in &accounting.truncations {
            self.add_truncation(
                truncation.source,
                truncation.reason,
                truncation.count,
                truncation.omitted_bytes,
            )?;
        }
        Ok(())
    }

    fn add_secret(
        &mut self,
        class: SupportSecretClassV1,
        count: u64,
    ) -> Result<(), SupportAssemblyError> {
        let slot = match class {
            SupportSecretClassV1::Authorization => &mut self.scrubbed.authorization,
            SupportSecretClassV1::Cookie => &mut self.scrubbed.cookie,
            SupportSecretClassV1::AccessToken => &mut self.scrubbed.access_token,
            SupportSecretClassV1::RefreshToken => &mut self.scrubbed.refresh_token,
            SupportSecretClassV1::IdentityToken => &mut self.scrubbed.identity_token,
            SupportSecretClassV1::ApiKey => &mut self.scrubbed.api_key,
            SupportSecretClassV1::ClientSecret => &mut self.scrubbed.client_secret,
            SupportSecretClassV1::Password => &mut self.scrubbed.password,
            SupportSecretClassV1::PrivateKey => &mut self.scrubbed.private_key,
            SupportSecretClassV1::CredentialContainer => &mut self.scrubbed.credential_container,
            SupportSecretClassV1::EnvironmentSecret => &mut self.scrubbed.environment_secret,
            SupportSecretClassV1::SignedUrl => &mut self.scrubbed.signed_url,
            SupportSecretClassV1::ProviderCredential => &mut self.scrubbed.provider_credential,
            SupportSecretClassV1::OpaqueCredential => &mut self.scrubbed.opaque_credential,
            SupportSecretClassV1::UrlUserinfo => &mut self.scrubbed.url_userinfo,
        };
        *slot = slot
            .checked_add(count)
            .ok_or(SupportAssemblyError::AccountingOverflow)?;
        Ok(())
    }

    pub(super) fn add_omission(
        &mut self,
        source: SupportEvidenceSourceV1,
        reason: SupportOmissionReasonV1,
        count: u64,
        known_bytes: Option<u64>,
    ) -> Result<(), SupportAssemblyError> {
        if count == 0 {
            return Ok(());
        }
        let entry = self
            .omissions
            .entry((source, reason))
            .or_insert(OmissionCount {
                count: 0,
                known_bytes: Some(0),
            });
        entry.count = entry
            .count
            .checked_add(count)
            .ok_or(SupportAssemblyError::AccountingOverflow)?;
        entry.known_bytes = checked_optional_add(entry.known_bytes, known_bytes)?;
        Ok(())
    }

    pub(super) fn ensure_omission(
        &mut self,
        source: SupportEvidenceSourceV1,
        reason: SupportOmissionReasonV1,
    ) -> Result<(), SupportAssemblyError> {
        match self.omissions.get(&(source, reason)) {
            Some(entry) if entry.count == 1 => Ok(()),
            Some(_) => Err(SupportAssemblyError::InvalidSourceAccounting),
            None => self.add_omission(source, reason, 1, None),
        }
    }

    pub(super) fn add_truncation(
        &mut self,
        source: SupportEvidenceSourceV1,
        reason: SupportTruncationReasonV1,
        count: u64,
        omitted_bytes: Option<u64>,
    ) -> Result<(), SupportAssemblyError> {
        if count == 0 {
            return Ok(());
        }
        let entry = self
            .truncations
            .entry((source, reason))
            .or_insert(TruncationCount {
                count: 0,
                omitted_bytes: Some(0),
            });
        entry.count = entry
            .count
            .checked_add(count)
            .ok_or(SupportAssemblyError::AccountingOverflow)?;
        entry.omitted_bytes = checked_optional_add(entry.omitted_bytes, omitted_bytes)?;
        Ok(())
    }

    pub(super) fn note_source_cap(
        &mut self,
        source: SupportEvidenceSourceV1,
        count: u64,
        bytes: u64,
        reason: SupportTruncationReasonV1,
    ) -> Result<(), SupportAssemblyError> {
        self.add_omission(
            source,
            SupportOmissionReasonV1::SourceCap,
            count,
            Some(bytes),
        )?;
        self.add_truncation(source, reason, count, Some(bytes))
    }

    pub(super) fn note_package_removal(
        &mut self,
        tier: u8,
        count: u64,
        bytes: u64,
    ) -> Result<(), SupportAssemblyError> {
        let slot = self
            .removed_by_tier
            .get_mut(usize::from(tier.saturating_sub(1)))
            .ok_or(SupportAssemblyError::InvalidSourceAccounting)?;
        *slot = slot
            .checked_add(1)
            .ok_or(SupportAssemblyError::AccountingOverflow)?;
        self.add_omission(
            SupportEvidenceSourceV1::Package,
            SupportOmissionReasonV1::PackageCap,
            count,
            Some(bytes),
        )?;
        self.add_truncation(
            SupportEvidenceSourceV1::Package,
            SupportTruncationReasonV1::PackageBytes,
            count,
            Some(bytes),
        )
    }

    pub(super) fn materialize(
        &self,
        additional_gaps: u64,
    ) -> (
        SupportSecretScrubCountsV1,
        Vec<SupportOmissionV1>,
        Vec<SupportTruncationV1>,
        SupportAdditionalEntriesV1,
    ) {
        let omission_total = self.omissions.len();
        let truncation_total = self.truncations.len();
        let omissions = self
            .omissions
            .iter()
            .take(MAX_OMISSION_ENTRIES)
            .map(|(&(source, reason), entry)| SupportOmissionV1 {
                source,
                reason,
                count: entry.count,
                known_bytes: entry.known_bytes,
            })
            .collect();
        let truncations = self
            .truncations
            .iter()
            .take(MAX_TRUNCATION_ENTRIES)
            .map(|(&(source, reason), entry)| SupportTruncationV1 {
                source,
                reason,
                count: entry.count,
                omitted_bytes: entry.omitted_bytes,
            })
            .collect();
        (
            self.scrubbed.clone(),
            omissions,
            truncations,
            SupportAdditionalEntriesV1 {
                gaps: additional_gaps,
                omissions: omission_total.saturating_sub(MAX_OMISSION_ENTRIES) as u64,
                truncations: truncation_total.saturating_sub(MAX_TRUNCATION_ENTRIES) as u64,
            },
        )
    }
}

#[derive(Debug, Clone)]
pub(super) struct SourceLedger {
    entries: BTreeMap<SupportSourceManifestSourceV1, SupportSourceManifestV1>,
}

impl SourceLedger {
    pub(super) fn new(captures: Vec<SupportSourceCaptureV1>) -> Result<Self, SupportAssemblyError> {
        let mut entries = BTreeMap::new();
        for capture in captures {
            if entries
                .insert(
                    capture.source,
                    SupportSourceManifestV1 {
                        source: capture.source,
                        state: capture.state,
                        captured_at: capture.captured_at,
                        read_bytes: capture.read_bytes,
                        included_bytes: 0,
                        included_items: 0,
                    },
                )
                .is_some()
            {
                return Err(SupportAssemblyError::InvalidSourceAccounting);
            }
        }
        Ok(Self { entries })
    }

    pub(super) fn state(
        &self,
        source: SupportSourceManifestSourceV1,
    ) -> Option<SupportSourceStateV1> {
        self.entries.get(&source).map(|entry| entry.state)
    }

    pub(super) fn read_bytes(&self, source: SupportSourceManifestSourceV1) -> Option<u64> {
        self.entries.get(&source).map(|entry| entry.read_bytes)
    }

    pub(super) fn set_included(
        &mut self,
        source: SupportSourceManifestSourceV1,
        bytes: u64,
        items: u64,
    ) -> Result<(), SupportAssemblyError> {
        let entry = self
            .entries
            .get_mut(&source)
            .ok_or(SupportAssemblyError::InvalidSourceAccounting)?;
        if entry.state != SupportSourceStateV1::Included
            || bytes > entry.read_bytes
            || (entry.state != SupportSourceStateV1::Included && (bytes != 0 || items != 0))
        {
            return Err(SupportAssemblyError::InvalidSourceAccounting);
        }
        entry.included_bytes = bytes;
        entry.included_items = items;
        Ok(())
    }

    pub(super) fn materialize(&self) -> Vec<SupportSourceManifestV1> {
        self.entries.values().cloned().collect()
    }
}

fn checked_optional_add(
    left: Option<u64>,
    right: Option<u64>,
) -> Result<Option<u64>, SupportAssemblyError> {
    match (left, right) {
        (Some(left), Some(right)) => left
            .checked_add(right)
            .map(Some)
            .ok_or(SupportAssemblyError::AccountingOverflow),
        _ => Ok(None),
    }
}

fn secret_classes() -> [SupportSecretClassV1; 15] {
    [
        SupportSecretClassV1::Authorization,
        SupportSecretClassV1::Cookie,
        SupportSecretClassV1::AccessToken,
        SupportSecretClassV1::RefreshToken,
        SupportSecretClassV1::IdentityToken,
        SupportSecretClassV1::ApiKey,
        SupportSecretClassV1::ClientSecret,
        SupportSecretClassV1::Password,
        SupportSecretClassV1::PrivateKey,
        SupportSecretClassV1::CredentialContainer,
        SupportSecretClassV1::EnvironmentSecret,
        SupportSecretClassV1::SignedUrl,
        SupportSecretClassV1::ProviderCredential,
        SupportSecretClassV1::OpaqueCredential,
        SupportSecretClassV1::UrlUserinfo,
    ]
}
