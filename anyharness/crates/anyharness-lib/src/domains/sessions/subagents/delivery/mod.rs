//! Durable terminal-completion capture and eventual parent delivery.

mod runtime;

pub use runtime::CompletionDeliveryWorker;

pub use crate::domains::sessions::store::completion_deliveries::{
    CompletionDeliveryRecord, CompletionDeliveryState, CompletionDeliveryStore,
};
