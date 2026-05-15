use super::{InventoryPayload, InventoryRequest};

pub fn report(
    payload: InventoryPayload,
    status: impl Into<String>,
    status_detail: Option<String>,
) -> InventoryRequest {
    InventoryRequest {
        inventory: payload,
        status: status.into(),
        status_detail,
    }
}
