use std::collections::BTreeMap;

use proliferate_diagnostics_protocol::v1::limits::{
    CURRENT_SCHEMA_VERSION, DEFAULT_PAGE_RECORDS, MAX_SAFE_INTEGER,
};
use proliferate_diagnostics_protocol::v1::types::{
    RecordsFilterV1, RecordsQueryV1, RejectionReasonV1, SchemaVersionV1,
};

pub(crate) fn parse_records_query(raw: Option<&str>) -> Result<RecordsQueryV1, RejectionReasonV1> {
    let params = parse_params(raw.unwrap_or_default());
    let schema_version = parse_schema_version(single(&params, "schema_version")?)?;
    let after_cursor = optional_integer(&params, "after_cursor")?;
    let limit = match single_optional(&params, "limit")? {
        Some(value) => parse_integer(value)?
            .try_into()
            .map_err(|_| RejectionReasonV1::LimitExceeded)?,
        None => DEFAULT_PAGE_RECORDS,
    };
    let filters = RecordsFilterV1 {
        source_time_from: owned_optional(&params, "source_time_from")?,
        source_time_to: owned_optional(&params, "source_time_to")?,
        components: parse_list(&params, "component")?,
        record_classes: parse_list(&params, "record_class")?,
        severities: parse_list(&params, "severity")?,
        names: string_list(&params, "name"),
        outcomes: parse_list(&params, "outcome")?,
        operation_id: owned_optional(&params, "operation_id")?,
        parent_operation_id: owned_optional(&params, "parent_operation_id")?,
        trace_id: owned_optional(&params, "trace_id")?,
        workspace_id: owned_optional(&params, "workspace_id")?,
        session_id: owned_optional(&params, "session_id")?,
        turn_id: owned_optional(&params, "turn_id")?,
        item_id: owned_optional(&params, "item_id")?,
        request_id: owned_optional(&params, "request_id")?,
        target_id: owned_optional(&params, "target_id")?,
        prompt_id: owned_optional(&params, "prompt_id")?,
        workflow_id: owned_optional(&params, "workflow_id")?,
        error_classification: owned_optional(&params, "error_classification")?,
    };
    Ok(RecordsQueryV1 {
        schema_version,
        after_cursor,
        limit,
        filters,
    })
}

pub(crate) fn parse_tail_cursor(raw: Option<&str>) -> Result<u64, RejectionReasonV1> {
    let params = parse_params(raw.unwrap_or_default());
    let version = parse_schema_version(single(&params, "schema_version")?)?;
    if version != CURRENT_SCHEMA_VERSION {
        return Err(if version.major != CURRENT_SCHEMA_VERSION.major {
            RejectionReasonV1::UnsupportedMajor
        } else {
            RejectionReasonV1::UnsupportedMinor
        });
    }
    Ok(optional_integer(&params, "after_cursor")?.unwrap_or(0))
}

fn parse_params(raw: &str) -> BTreeMap<String, Vec<String>> {
    let mut params = BTreeMap::<String, Vec<String>>::new();
    for (key, value) in url::form_urlencoded::parse(raw.as_bytes()) {
        params
            .entry(key.into_owned())
            .or_default()
            .push(value.into_owned());
    }
    params
}

fn single<'a>(
    params: &'a BTreeMap<String, Vec<String>>,
    name: &str,
) -> Result<&'a str, RejectionReasonV1> {
    single_optional(params, name)?.ok_or(RejectionReasonV1::InvalidShape)
}

fn single_optional<'a>(
    params: &'a BTreeMap<String, Vec<String>>,
    name: &str,
) -> Result<Option<&'a str>, RejectionReasonV1> {
    match params.get(name).map(Vec::as_slice) {
        None | Some([]) => Ok(None),
        Some([value]) => Ok(Some(value)),
        Some(_) => Err(RejectionReasonV1::InvalidShape),
    }
}

fn owned_optional(
    params: &BTreeMap<String, Vec<String>>,
    name: &str,
) -> Result<Option<String>, RejectionReasonV1> {
    Ok(single_optional(params, name)?.map(str::to_owned))
}

fn optional_integer(
    params: &BTreeMap<String, Vec<String>>,
    name: &str,
) -> Result<Option<u64>, RejectionReasonV1> {
    single_optional(params, name)?
        .map(parse_integer)
        .transpose()
}

fn parse_integer(value: &str) -> Result<u64, RejectionReasonV1> {
    if value.is_empty()
        || !value.bytes().all(|byte| byte.is_ascii_digit())
        || (value.len() > 1 && value.starts_with('0'))
    {
        return Err(RejectionReasonV1::InvalidShape);
    }
    let value = value
        .parse::<u64>()
        .map_err(|_| RejectionReasonV1::LimitExceeded)?;
    if value > MAX_SAFE_INTEGER {
        return Err(RejectionReasonV1::LimitExceeded);
    }
    Ok(value)
}

fn parse_schema_version(value: &str) -> Result<SchemaVersionV1, RejectionReasonV1> {
    let Some((major, minor)) = value.split_once('.') else {
        return Err(RejectionReasonV1::InvalidShape);
    };
    let major = parse_integer(major)?
        .try_into()
        .map_err(|_| RejectionReasonV1::LimitExceeded)?;
    let minor = parse_integer(minor)?
        .try_into()
        .map_err(|_| RejectionReasonV1::LimitExceeded)?;
    let version = SchemaVersionV1 { major, minor };
    if version.major != CURRENT_SCHEMA_VERSION.major {
        return Err(RejectionReasonV1::UnsupportedMajor);
    }
    if version.minor > CURRENT_SCHEMA_VERSION.minor {
        return Err(RejectionReasonV1::UnsupportedMinor);
    }
    Ok(version)
}

fn string_list(params: &BTreeMap<String, Vec<String>>, name: &str) -> Vec<String> {
    params
        .get(name)
        .into_iter()
        .flatten()
        .flat_map(|value| value.split(','))
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .collect()
}

fn parse_list<T>(
    params: &BTreeMap<String, Vec<String>>,
    name: &str,
) -> Result<Vec<T>, RejectionReasonV1>
where
    T: serde::de::DeserializeOwned,
{
    string_list(params, name)
        .into_iter()
        .map(|value| {
            serde_json::from_value(serde_json::Value::String(value))
                .map_err(|_| RejectionReasonV1::InvalidShape)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use proliferate_diagnostics_protocol::v1::limits::{
        DEFAULT_PAGE_RECORDS, MAX_FILTER_VALUES, MAX_PAGE_RECORDS, MAX_SAFE_INTEGER,
    };
    use proliferate_diagnostics_protocol::v1::types::RejectionReasonV1;
    use proliferate_diagnostics_protocol::v1::validation::validate_records_query;

    use super::{parse_records_query, parse_tail_cursor};

    #[test]
    fn concrete_query_encoding_pins_defaults_and_integer_boundaries() {
        let default = parse_records_query(Some("schema_version=1.1")).expect("default query");
        assert_eq!(default.limit, DEFAULT_PAGE_RECORDS);
        assert!(validate_records_query(&default).is_ok());

        let maximum = parse_records_query(Some(&format!(
            "schema_version=1.1&after_cursor={MAX_SAFE_INTEGER}&limit={MAX_PAGE_RECORDS}"
        )))
        .expect("maximum query");
        assert!(validate_records_query(&maximum).is_ok());
        assert_eq!(
            parse_records_query(Some(&format!(
                "schema_version=1.1&after_cursor={}&limit={MAX_PAGE_RECORDS}",
                MAX_SAFE_INTEGER + 1
            ))),
            Err(RejectionReasonV1::LimitExceeded)
        );
        assert_eq!(
            parse_tail_cursor(Some(&format!(
                "schema_version=1.1&after_cursor={}",
                MAX_SAFE_INTEGER + 1
            ))),
            Err(RejectionReasonV1::LimitExceeded)
        );
    }

    #[test]
    fn repeatable_filter_encoding_reaches_the_frozen_boundary() {
        let at = format!(
            "schema_version=1.1&{}",
            (0..MAX_FILTER_VALUES)
                .map(|index| format!("name=name{index}"))
                .collect::<Vec<_>>()
                .join("&")
        );
        let at = parse_records_query(Some(&at)).expect("at-bound query");
        assert!(validate_records_query(&at).is_ok());

        let over = format!(
            "schema_version=1.1&{}",
            (0..=MAX_FILTER_VALUES)
                .map(|index| format!("name=name{index}"))
                .collect::<Vec<_>>()
                .join("&")
        );
        let over = parse_records_query(Some(&over)).expect("parsed over-bound query");
        assert_eq!(
            validate_records_query(&over),
            Err(RejectionReasonV1::LimitExceeded)
        );
    }
}
