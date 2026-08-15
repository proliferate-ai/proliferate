//! Stable exporter error classifications.
//!
//! The published classification is drawn from this fixed table and is never
//! built from a provider message, URL, or response body, so `/v1/health` can
//! never echo a destination or its credential back to a caller.

use std::sync::atomic::{AtomicU8, Ordering};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ExportFailure {
    InvalidConfiguration,
    Encode,
    Connect,
    Timeout,
    HttpClientError,
    HttpServerError,
    Request,
}

impl ExportFailure {
    const fn code(self) -> u8 {
        match self {
            Self::InvalidConfiguration => 1,
            Self::Encode => 2,
            Self::Connect => 3,
            Self::Timeout => 4,
            Self::HttpClientError => 5,
            Self::HttpServerError => 6,
            Self::Request => 7,
        }
    }

    const fn from_code(code: u8) -> Option<Self> {
        match code {
            1 => Some(Self::InvalidConfiguration),
            2 => Some(Self::Encode),
            3 => Some(Self::Connect),
            4 => Some(Self::Timeout),
            5 => Some(Self::HttpClientError),
            6 => Some(Self::HttpServerError),
            7 => Some(Self::Request),
            _ => None,
        }
    }

    pub(super) const fn as_str(self) -> &'static str {
        match self {
            Self::InvalidConfiguration => "invalid_configuration",
            Self::Encode => "encode",
            Self::Connect => "connect",
            Self::Timeout => "timeout",
            Self::HttpClientError => "http_client_error",
            Self::HttpServerError => "http_server_error",
            Self::Request => "request",
        }
    }
}

/// The most recent classification, or none since the last success.
#[derive(Default)]
pub(super) struct LastFailure(AtomicU8);

impl LastFailure {
    pub(super) fn set(&self, failure: ExportFailure) {
        self.0.store(failure.code(), Ordering::Relaxed);
    }

    pub(super) fn clear(&self) {
        self.0.store(0, Ordering::Relaxed);
    }

    pub(super) fn get(&self) -> Option<&'static str> {
        ExportFailure::from_code(self.0.load(Ordering::Relaxed)).map(ExportFailure::as_str)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALL: [ExportFailure; 7] = [
        ExportFailure::InvalidConfiguration,
        ExportFailure::Encode,
        ExportFailure::Connect,
        ExportFailure::Timeout,
        ExportFailure::HttpClientError,
        ExportFailure::HttpServerError,
        ExportFailure::Request,
    ];

    #[test]
    fn every_classification_round_trips_through_its_code() {
        for failure in ALL {
            assert_eq!(ExportFailure::from_code(failure.code()), Some(failure));
        }
        assert_eq!(ExportFailure::from_code(0), None);
        assert_eq!(ExportFailure::from_code(u8::MAX), None);
    }

    #[test]
    fn last_failure_starts_empty_and_clears_back_to_empty() {
        let last = LastFailure::default();
        assert_eq!(last.get(), None);
        last.set(ExportFailure::Timeout);
        assert_eq!(last.get(), Some("timeout"));
        last.clear();
        assert_eq!(last.get(), None);
    }
}
