use super::{InventoryPayload, InventoryRequest};

pub fn report(payload: InventoryPayload) -> InventoryRequest {
    InventoryRequest {
        inventory: payload,
        status: "online".to_string(),
        status_detail: None,
    }
}
