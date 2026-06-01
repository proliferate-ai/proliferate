use std::ffi::OsString;
use std::sync::{Mutex, OnceLock};

use crate::domains::sessions::mcp_bindings::crypto::DATA_KEY_ENV_VAR;

pub(crate) static ENV_MUTEX: OnceLock<Mutex<()>> = OnceLock::new();

pub(crate) struct BearerTokenEnvGuard {
    previous: Option<OsString>,
}

impl Drop for BearerTokenEnvGuard {
    fn drop(&mut self) {
        match self.previous.as_ref() {
            Some(value) => std::env::set_var("ANYHARNESS_BEARER_TOKEN", value),
            None => std::env::remove_var("ANYHARNESS_BEARER_TOKEN"),
        }
    }
}

pub(crate) fn set_bearer_token_env(value: Option<&str>) -> BearerTokenEnvGuard {
    let previous = std::env::var_os("ANYHARNESS_BEARER_TOKEN");
    match value {
        Some(token) => std::env::set_var("ANYHARNESS_BEARER_TOKEN", token),
        None => std::env::remove_var("ANYHARNESS_BEARER_TOKEN"),
    }
    BearerTokenEnvGuard { previous }
}

pub(crate) struct DataKeyEnvGuard {
    previous: Option<OsString>,
}

impl Drop for DataKeyEnvGuard {
    fn drop(&mut self) {
        match self.previous.as_ref() {
            Some(value) => std::env::set_var(DATA_KEY_ENV_VAR, value),
            None => std::env::remove_var(DATA_KEY_ENV_VAR),
        }
    }
}

pub(crate) fn set_data_key_env(value: Option<&str>) -> DataKeyEnvGuard {
    let previous = std::env::var_os(DATA_KEY_ENV_VAR);
    match value {
        Some(key) => std::env::set_var(DATA_KEY_ENV_VAR, key),
        None => std::env::remove_var(DATA_KEY_ENV_VAR),
    }
    DataKeyEnvGuard { previous }
}

pub(crate) struct ProliferateDevEnvGuard {
    previous: Option<OsString>,
}

impl Drop for ProliferateDevEnvGuard {
    fn drop(&mut self) {
        match self.previous.as_ref() {
            Some(value) => std::env::set_var("PROLIFERATE_DEV", value),
            None => std::env::remove_var("PROLIFERATE_DEV"),
        }
    }
}

pub(crate) fn set_proliferate_dev_env(value: Option<&str>) -> ProliferateDevEnvGuard {
    let previous = std::env::var_os("PROLIFERATE_DEV");
    match value {
        Some(flag) => std::env::set_var("PROLIFERATE_DEV", flag),
        None => std::env::remove_var("PROLIFERATE_DEV"),
    }
    ProliferateDevEnvGuard { previous }
}
