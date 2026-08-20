use super::service::{state_for, LaunchSelectionUnsupported};
use super::store::read_row;
use super::types::{HarnessLaunchOptionStateRow, LaunchSelection};

/// Reload and exactly validate one selection using the caller's connection.
/// Session stores call this after opening their write transaction, so the
/// current launch-option row cannot advance between admission and the durable
/// session/intent insert.
pub(crate) fn validate_selection_in_conn(
    conn: &rusqlite::Connection,
    harness_kind: &str,
    current_basis: &str,
    selection: &LaunchSelection,
) -> Result<HarnessLaunchOptionStateRow, LaunchSelectionUnsupported> {
    let row = read_row(conn, harness_kind)
        .map_err(|error| LaunchSelectionUnsupported::Internal(anyhow::Error::new(error)))?;
    validate_selection_row(row, current_basis, selection)
}

pub(super) fn validate_selection_row(
    row: Option<HarnessLaunchOptionStateRow>,
    current_basis: &str,
    selection: &LaunchSelection,
) -> Result<HarnessLaunchOptionStateRow, LaunchSelectionUnsupported> {
    let Some(row) = row else {
        return Err(LaunchSelectionUnsupported::ObservationUnavailable { state: None });
    };
    let state = state_for(&row);
    if row.basis_revision != current_basis {
        return Err(LaunchSelectionUnsupported::ObservationUnavailable { state: Some(state) });
    }
    let Some(options) = row.options.as_ref() else {
        return Err(LaunchSelectionUnsupported::ObservationUnavailable { state: Some(state) });
    };
    if let Some(model_id) = selection.model_id.as_deref() {
        if !options.models.iter().any(|model| model.id == model_id) {
            return Err(LaunchSelectionUnsupported::Model {
                model_id: model_id.to_string(),
                state,
            });
        }
    }
    for (control_id, value) in &selection.control_values {
        let Some(control) = options
            .controls
            .iter()
            .find(|control| &control.id == control_id)
        else {
            return Err(LaunchSelectionUnsupported::Control {
                control_id: control_id.clone(),
                state,
            });
        };
        if !control
            .values
            .iter()
            .any(|candidate| &candidate.value == value)
        {
            return Err(LaunchSelectionUnsupported::ControlValue {
                control_id: control_id.clone(),
                value: value.clone(),
                state,
            });
        }
    }
    Ok(row)
}
