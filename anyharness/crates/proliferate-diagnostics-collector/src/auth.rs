use std::net::SocketAddr;
use std::sync::Arc;

use axum::extract::{ConnectInfo, Request, State};
use axum::http::{header, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use subtle::ConstantTimeEq;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

const MAX_CAPABILITY_BYTES: usize = 256;

pub(crate) struct Capability {
    bytes: [u8; MAX_CAPABILITY_BYTES],
    len: u16,
}

impl Capability {
    pub(crate) fn new(value: &[u8]) -> Result<Self, &'static str> {
        if value.is_empty()
            || value.len() > MAX_CAPABILITY_BYTES
            || !value.iter().all(|byte| (0x21..=0x7e).contains(byte))
        {
            return Err("capability must be 1-256 visible ASCII bytes");
        }
        let mut bytes = [0; MAX_CAPABILITY_BYTES];
        bytes[..value.len()].copy_from_slice(value);
        Ok(Self {
            bytes,
            len: value.len() as u16,
        })
    }

    fn matches(&self, candidate: &[u8]) -> bool {
        let mut padded = [0; MAX_CAPABILITY_BYTES];
        let copied = candidate.len().min(MAX_CAPABILITY_BYTES);
        padded[..copied].copy_from_slice(&candidate[..copied]);
        let candidate_len = u16::try_from(candidate.len()).unwrap_or(u16::MAX);
        let bytes_match = self.bytes.ct_eq(&padded);
        let length_match = self.len.to_be_bytes().ct_eq(&candidate_len.to_be_bytes());
        bool::from(bytes_match & length_match)
    }
}

impl Drop for Capability {
    fn drop(&mut self) {
        self.bytes.fill(0);
        self.len = 0;
    }
}

pub(crate) struct RequestGuard {
    capability: Capability,
    handlers: Arc<Semaphore>,
}

impl RequestGuard {
    pub(crate) fn new(capability: &[u8], handler_limit: usize) -> Result<Self, &'static str> {
        Ok(Self {
            capability: Capability::new(capability)?,
            handlers: Arc::new(Semaphore::new(handler_limit)),
        })
    }
}

#[derive(Clone)]
struct HandlerPermit {
    _permit: Arc<OwnedSemaphorePermit>,
}

pub(crate) async fn authorize(
    State(guard): State<Arc<RequestGuard>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    request: Request,
    next: Next,
) -> Response {
    if !peer.ip().is_loopback() {
        return StatusCode::FORBIDDEN.into_response();
    }
    if request.headers().contains_key(header::ORIGIN) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let Some(candidate) = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|value| value.as_bytes().strip_prefix(b"Bearer "))
    else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    if !guard.capability.matches(candidate) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let Ok(permit) = Arc::clone(&guard.handlers).try_acquire_owned() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    let mut response = next.run(request).await;
    response.extensions_mut().insert(HandlerPermit {
        _permit: Arc::new(permit),
    });
    response
}

#[cfg(test)]
mod tests {
    use super::Capability;

    #[test]
    fn capability_comparison_matches_only_identical_bytes() {
        let capability = Capability::new(b"capability-123").expect("valid capability");
        assert!(capability.matches(b"capability-123"));
        assert!(!capability.matches(b"capability-124"));
        assert!(!capability.matches(b"capability-1234"));
        assert!(!capability.matches(b""));
    }
}
