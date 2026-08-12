use std::collections::BTreeMap;

use proliferate_diagnostics_protocol::v1::types::ExportStreamFrameV1;
use proliferate_diagnostics_protocol::v1::types::{
    ArgumentValueV1, CollectorAcceptedRecordV1, PrivacyClassificationV1, ProducerRecordV1,
    RedactionClassificationV1, TypedArgumentV1,
};
use proliferate_diagnostics_protocol::v1::validation::{
    validate_export_frame, validate_producer_record,
};

use super::super::schema::enums::{
    SupportEvidenceSourceV1, SupportOmissionReasonV1, SupportSecretClassV1,
    SupportTruncationReasonV1,
};
use super::super::schema::limits::{CONTAINER_ITEMS, GENERIC_STRING_BYTES, NESTING_DEPTH};
use super::super::schema::validate::{validate_safe_i64, validate_support_number};
use super::accounting::{redaction_marker, SupportScrubAccounting};
use super::text::{to_u64, TextRole};
use super::value::{normalize_key, role_for_key, secret_key_class};
use super::{SupportExportScrubber, SupportOptionalScrubbed, SupportScrubError};

macro_rules! scrub_optional_text {
    ($scrubber:expr, $record:expr, $source:expr, $accounting:expr, $role:expr, $($field:ident),+ $(,)?) => {
        $(
            if let Some(value) = $record.$field.take() {
                $record.$field = $scrubber.scrub_owned_record_text(
                    value,
                    $role,
                    $source,
                    $accounting,
                )?;
            }
        )+
    };
}

impl SupportExportScrubber {
    /// Scrub one optional producer record without mutating the caller's local
    /// copy. Identity and privacy are retained; successful output is marked
    /// `support_export`.
    pub fn scrub_producer_record(
        &self,
        record: ProducerRecordV1,
        source: SupportEvidenceSourceV1,
    ) -> Result<SupportOptionalScrubbed<ProducerRecordV1>, SupportScrubError> {
        let mut accounting = SupportScrubAccounting::default();
        let result = self.scrub_producer_record_into(record, source, &mut accounting);
        let value = self.optional_record_result(result, source, &mut accounting)?;
        Ok(SupportOptionalScrubbed { value, accounting })
    }

    /// Scrub one optional collector-accepted record while preserving accepted
    /// timestamp, order, cursor, producer identity, component, source, and
    /// privacy classification.
    pub fn scrub_accepted_record(
        &self,
        mut record: CollectorAcceptedRecordV1,
        source: SupportEvidenceSourceV1,
    ) -> Result<SupportOptionalScrubbed<CollectorAcceptedRecordV1>, SupportScrubError> {
        let mut accounting = SupportScrubAccounting::default();
        let result = (|| {
            record.accepted_timestamp = required(self.scrub_text_into(
                &record.accepted_timestamp,
                record.accepted_timestamp.len(),
                TextRole::ProtocolTimestamp,
                source,
                &mut accounting,
            )?)?;
            record.record = required(self.scrub_producer_record_into(
                record.record,
                source,
                &mut accounting,
            )?)?;
            if validate_export_frame(&ExportStreamFrameV1::Record {
                record: record.clone(),
            })
            .is_err()
            {
                return Ok(None);
            }
            Ok(Some(record))
        })();
        let value = self.optional_record_result(result, source, &mut accounting)?;
        Ok(SupportOptionalScrubbed { value, accounting })
    }

    fn scrub_producer_record_into(
        &self,
        mut record: ProducerRecordV1,
        source: SupportEvidenceSourceV1,
        accounting: &mut SupportScrubAccounting,
    ) -> Result<Option<ProducerRecordV1>, SupportScrubError> {
        if record.privacy == PrivacyClassificationV1::Secret {
            accounting.record_secret(SupportSecretClassV1::OpaqueCredential, 1)?;
            return Ok(None);
        }

        record.source_timestamp = required(self.scrub_owned_record_text(
            record.source_timestamp,
            TextRole::ProtocolTimestamp,
            source,
            accounting,
        )?)?;
        record.producer_boot_id = required(self.scrub_owned_record_text(
            record.producer_boot_id,
            TextRole::Identifier,
            source,
            accounting,
        )?)?;
        record.release = required(self.scrub_owned_record_text(
            record.release,
            TextRole::Name,
            source,
            accounting,
        )?)?;
        // The accepted record's top-level release environment is an explicit
        // semantic role, never a raw environment container.
        record.environment = required(self.scrub_owned_record_text(
            record.environment,
            TextRole::Name,
            source,
            accounting,
        )?)?;
        record.operation_id = required(self.scrub_owned_record_text(
            record.operation_id,
            TextRole::Identifier,
            source,
            accounting,
        )?)?;

        scrub_optional_text!(
            self,
            record,
            source,
            accounting,
            TextRole::Identifier,
            parent_operation_id,
            trace_id,
            workspace_id,
            session_id,
            turn_id,
            item_id,
            request_id,
            target_id,
            prompt_id,
            workflow_id
        );
        record.name = required(self.scrub_owned_record_text(
            record.name,
            TextRole::Name,
            source,
            accounting,
        )?)?;

        let mut arguments = Vec::with_capacity(record.arguments.len().min(CONTAINER_ITEMS));
        if record.arguments.len() > CONTAINER_ITEMS {
            accounting.record_truncation(
                source,
                SupportTruncationReasonV1::ContainerItems,
                to_u64(record.arguments.len() - CONTAINER_ITEMS)?,
                None,
            )?;
        }
        for argument in record.arguments.into_iter().take(CONTAINER_ITEMS) {
            if let Some(argument) = self.scrub_argument(argument, source, accounting)? {
                arguments.push(argument);
            }
        }
        record.arguments = arguments;

        if let Some(classification) = record.error_classification.take() {
            record.error_classification =
                self.scrub_owned_record_text(classification, TextRole::Name, source, accounting)?;
        }
        if let Some(detailed) = &mut record.detailed {
            if let Some(message) = detailed.message.take() {
                detailed.message =
                    self.scrub_owned_record_text(message, TextRole::Content, source, accounting)?;
            }
            if let Some(milestone) = detailed.milestone.take() {
                detailed.milestone =
                    self.scrub_owned_record_text(milestone, TextRole::Name, source, accounting)?;
            }
        }
        if let Some(lifecycle) = &mut record.lifecycle {
            if let Some(model) = &mut lifecycle.model {
                model.model_id = required(self.scrub_owned_record_text(
                    std::mem::take(&mut model.model_id),
                    TextRole::Identifier,
                    source,
                    accounting,
                )?)?;
                if let Some(provider) = model.provider_kind.take() {
                    model.provider_kind =
                        self.scrub_owned_record_text(provider, TextRole::Name, source, accounting)?;
                }
            }
            if let Some(plugin) = &mut lifecycle.plugin {
                plugin.plugin_id = required(self.scrub_owned_record_text(
                    std::mem::take(&mut plugin.plugin_id),
                    TextRole::Identifier,
                    source,
                    accounting,
                )?)?;
                if let Some(kind) = plugin.kind.take() {
                    plugin.kind =
                        self.scrub_owned_record_text(kind, TextRole::Name, source, accounting)?;
                }
            }
        }

        record.redaction = RedactionClassificationV1::SupportExport;
        if validate_producer_record(&record).is_err() {
            return Ok(None);
        }
        Ok(Some(record))
    }

    fn scrub_argument(
        &self,
        mut argument: TypedArgumentV1,
        source: SupportEvidenceSourceV1,
        accounting: &mut SupportScrubAccounting,
    ) -> Result<Option<TypedArgumentV1>, SupportScrubError> {
        if argument.name.len() > GENERIC_STRING_BYTES {
            accounting.record_omission(
                source,
                SupportOmissionReasonV1::SourceCap,
                1,
                Some(to_u64(argument.name.len())?),
            )?;
            return Ok(None);
        }
        let normalized = normalize_key(&argument.name);
        if argument.privacy == PrivacyClassificationV1::Secret {
            accounting.record_secret(
                secret_key_class(&normalized).unwrap_or(SupportSecretClassV1::OpaqueCredential),
                1,
            )?;
            return Ok(None);
        }
        if let Some(class) = secret_key_class(&normalized) {
            accounting.record_secret(class, 1)?;
            argument.value = ArgumentValueV1::String(redaction_marker(class).to_owned());
            return Ok(Some(argument));
        }
        argument.name = match self.scrub_owned_record_text(
            argument.name,
            TextRole::Name,
            source,
            accounting,
        )? {
            Some(name) => name,
            None => return Ok(None),
        };
        argument.value = match self.scrub_argument_value(
            argument.value,
            TextRole::Generic,
            0,
            source,
            accounting,
        )? {
            Some(value) => value,
            None => return Ok(None),
        };
        Ok(Some(argument))
    }

    fn scrub_argument_value(
        &self,
        value: ArgumentValueV1,
        role: TextRole,
        depth: usize,
        source: SupportEvidenceSourceV1,
        accounting: &mut SupportScrubAccounting,
    ) -> Result<Option<ArgumentValueV1>, SupportScrubError> {
        if depth > NESTING_DEPTH {
            return Err(SupportScrubError::TraversalLimit);
        }
        match value {
            ArgumentValueV1::String(value) => self
                .scrub_owned_record_text(value, role, source, accounting)
                .map(|value| value.map(ArgumentValueV1::String)),
            ArgumentValueV1::Enum(value) => self
                .scrub_owned_record_text(value, TextRole::Name, source, accounting)
                .map(|value| value.map(ArgumentValueV1::Enum)),
            ArgumentValueV1::Integer(value) => {
                validate_safe_i64(value).map_err(|_| SupportScrubError::InvalidValue)?;
                Ok(Some(ArgumentValueV1::Integer(value)))
            }
            ArgumentValueV1::Float(value) => {
                validate_support_number(value).map_err(|_| SupportScrubError::InvalidValue)?;
                Ok(Some(ArgumentValueV1::Float(value)))
            }
            ArgumentValueV1::Boolean(value) => Ok(Some(ArgumentValueV1::Boolean(value))),
            ArgumentValueV1::List(values) => {
                if values.len() > CONTAINER_ITEMS {
                    accounting.record_truncation(
                        source,
                        SupportTruncationReasonV1::ContainerItems,
                        to_u64(values.len() - CONTAINER_ITEMS)?,
                        None,
                    )?;
                }
                let mut scrubbed = Vec::with_capacity(values.len().min(CONTAINER_ITEMS));
                for value in values.into_iter().take(CONTAINER_ITEMS) {
                    if let Some(value) =
                        self.scrub_argument_value(value, role, depth + 1, source, accounting)?
                    {
                        scrubbed.push(value);
                    }
                }
                Ok(Some(ArgumentValueV1::List(scrubbed)))
            }
            ArgumentValueV1::Object(values) => {
                if values.len() > CONTAINER_ITEMS {
                    accounting.record_truncation(
                        source,
                        SupportTruncationReasonV1::ContainerItems,
                        to_u64(values.len() - CONTAINER_ITEMS)?,
                        None,
                    )?;
                }
                let mut scrubbed = BTreeMap::new();
                for (key, value) in values.into_iter().take(CONTAINER_ITEMS) {
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
                        if scrubbed
                            .insert(
                                key,
                                ArgumentValueV1::String(redaction_marker(class).to_owned()),
                            )
                            .is_some()
                        {
                            return Err(SupportScrubError::InvalidValue);
                        }
                        continue;
                    }
                    let Some(key) =
                        self.scrub_owned_record_text(key, TextRole::Name, source, accounting)?
                    else {
                        continue;
                    };
                    let child_role = role_for_key(&normalized);
                    if let Some(value) =
                        self.scrub_argument_value(value, child_role, depth + 1, source, accounting)?
                    {
                        if scrubbed.insert(key, value).is_some() {
                            return Err(SupportScrubError::InvalidValue);
                        }
                    }
                }
                Ok(Some(ArgumentValueV1::Object(scrubbed)))
            }
        }
    }

    fn scrub_owned_record_text(
        &self,
        value: String,
        role: TextRole,
        source: SupportEvidenceSourceV1,
        accounting: &mut SupportScrubAccounting,
    ) -> Result<Option<String>, SupportScrubError> {
        self.scrub_text_into(&value, value.len(), role, source, accounting)
    }

    fn optional_record_result<T>(
        &self,
        result: Result<Option<T>, SupportScrubError>,
        source: SupportEvidenceSourceV1,
        accounting: &mut SupportScrubAccounting,
    ) -> Result<Option<T>, SupportScrubError> {
        let value = match result {
            Ok(value) => value,
            Err(SupportScrubError::TraversalLimit | SupportScrubError::InvalidValue) => None,
            Err(error) => return Err(error),
        };
        if value.is_none() {
            accounting.record_omission(source, SupportOmissionReasonV1::SourceInvalid, 1, None)?;
        }
        Ok(value)
    }
}

fn required<T>(value: Option<T>) -> Result<T, SupportScrubError> {
    value.ok_or(SupportScrubError::InvalidValue)
}
