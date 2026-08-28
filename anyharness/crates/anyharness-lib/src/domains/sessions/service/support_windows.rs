use super::SessionService;
use crate::domains::sessions::model::{
    SessionEventRecord, SessionRawNotificationRecord, SessionRecord,
};
use crate::domains::sessions::store::support_windows::{
    SupportEvidenceWindowFilter, SupportSessionWindowFilter, SupportWindowCandidate,
    SUPPORT_WINDOW_ITEM_BYTES,
};
use crate::persistence::sqlite::{CancelInterruptibleQueryOnDrop, InterruptibleQuery};

pub(crate) const SUPPORT_WINDOW_MIN_RESPONSE_BYTES: usize = 16_384;
pub(crate) const SUPPORT_SESSION_MAX_RESPONSE_BYTES: usize = 1_048_576;
pub(crate) const SUPPORT_EVENT_MAX_RESPONSE_BYTES: usize = 4_194_304;
pub(crate) const SUPPORT_RAW_NOTIFICATION_MAX_RESPONSE_BYTES: usize = 2_097_152;
pub(crate) const SUPPORT_SESSION_MAX_ITEMS: usize = 3;
pub(crate) const SUPPORT_EVENT_MAX_ITEMS: usize = 200;
pub(crate) const SUPPORT_RAW_NOTIFICATION_MAX_ITEMS: usize = 100;

pub(crate) enum SupportSessionWindowMode {
    Exact {
        session_id: String,
        updated_at_to: String,
    },
    Recent {
        updated_at_from: String,
        updated_at_to: String,
    },
}

pub(crate) struct SupportSessionWindowRequest {
    pub(crate) mode: SupportSessionWindowMode,
    pub(crate) limit: usize,
    pub(crate) max_response_bytes: usize,
}

pub(crate) struct SupportEvidenceWindowRequest {
    pub(crate) timestamp_from: String,
    pub(crate) timestamp_to: String,
    pub(crate) limit: usize,
    pub(crate) max_response_bytes: usize,
}

#[derive(Clone, Copy)]
pub(crate) enum SupportWindowPresentationOrder {
    UpdatedDescIdAsc,
    SeqAsc,
}

#[derive(Clone, Copy)]
pub(crate) enum SupportWindowCompleteness {
    Complete,
    LimitUncertain,
}

pub(crate) struct SupportWindowMeta {
    pub(crate) item_limit: usize,
    pub(crate) response_byte_limit: usize,
    pub(crate) returned_items: usize,
    pub(crate) omitted_oversized_items: usize,
    pub(crate) presentation_order: SupportWindowPresentationOrder,
    pub(crate) completeness: SupportWindowCompleteness,
}

enum PreparedSupportWindowCandidate {
    MetadataOversized,
    EncodedOversized,
    Item(Vec<u8>),
}

pub(crate) struct SupportWindowResult {
    pub(crate) meta: SupportWindowMeta,
    pub(crate) items: Vec<Vec<u8>>,
}

impl SessionService {
    pub(crate) fn begin_support_window_query(
        &self,
    ) -> (InterruptibleQuery, CancelInterruptibleQueryOnDrop) {
        self.session_store.begin_support_window_query()
    }

    pub(crate) fn session_support_window<F>(
        &self,
        workspace_id: &str,
        request: &SupportSessionWindowRequest,
        cancellation: &InterruptibleQuery,
        encode_item: F,
    ) -> anyhow::Result<SupportWindowResult>
    where
        F: FnMut(SessionRecord) -> anyhow::Result<Vec<u8>>,
    {
        let filter = match &request.mode {
            SupportSessionWindowMode::Exact {
                session_id,
                updated_at_to,
            } => SupportSessionWindowFilter::Exact {
                session_id: session_id.clone(),
                updated_at_to: updated_at_to.clone(),
            },
            SupportSessionWindowMode::Recent {
                updated_at_from,
                updated_at_to,
            } => SupportSessionWindowFilter::Recent {
                updated_at_from: updated_at_from.clone(),
                updated_at_to: updated_at_to.clone(),
            },
        };
        let rows = self.session_store.list_support_session_window(
            workspace_id,
            &filter,
            request.limit,
            cancellation,
        )?;
        select_bounded_window(
            rows.candidates,
            rows.has_more,
            request.limit,
            request.max_response_bytes,
            SupportWindowPresentationOrder::UpdatedDescIdAsc,
            false,
            cancellation,
            encode_item,
        )
    }

    pub(crate) fn event_support_window<F>(
        &self,
        session_id: &str,
        request: &SupportEvidenceWindowRequest,
        cancellation: &InterruptibleQuery,
        encode_item: F,
    ) -> anyhow::Result<Option<SupportWindowResult>>
    where
        F: FnMut(SessionEventRecord) -> anyhow::Result<Vec<u8>>,
    {
        let filter = SupportEvidenceWindowFilter {
            timestamp_from: request.timestamp_from.clone(),
            timestamp_to: request.timestamp_to.clone(),
        };
        let Some(rows) = self.session_store.list_support_event_window(
            session_id,
            &filter,
            request.limit,
            cancellation,
        )?
        else {
            return Ok(None);
        };
        select_bounded_window(
            rows.candidates,
            rows.has_more,
            request.limit,
            request.max_response_bytes,
            SupportWindowPresentationOrder::SeqAsc,
            true,
            cancellation,
            encode_item,
        )
        .map(Some)
    }

    pub(crate) fn raw_notification_support_window<F>(
        &self,
        session_id: &str,
        request: &SupportEvidenceWindowRequest,
        cancellation: &InterruptibleQuery,
        encode_item: F,
    ) -> anyhow::Result<Option<SupportWindowResult>>
    where
        F: FnMut(SessionRawNotificationRecord) -> anyhow::Result<Vec<u8>>,
    {
        let filter = SupportEvidenceWindowFilter {
            timestamp_from: request.timestamp_from.clone(),
            timestamp_to: request.timestamp_to.clone(),
        };
        let Some(rows) = self.session_store.list_support_raw_notification_window(
            session_id,
            &filter,
            request.limit,
            cancellation,
        )?
        else {
            return Ok(None);
        };
        select_bounded_window(
            rows.candidates,
            rows.has_more,
            request.limit,
            request.max_response_bytes,
            SupportWindowPresentationOrder::SeqAsc,
            true,
            cancellation,
            encode_item,
        )
        .map(Some)
    }
}

fn prepare_candidate<T, F>(
    candidate: SupportWindowCandidate<T>,
    cancellation: &InterruptibleQuery,
    serialize: &mut F,
) -> anyhow::Result<PreparedSupportWindowCandidate>
where
    F: FnMut(T) -> anyhow::Result<Vec<u8>>,
{
    cancellation.check_cancelled()?;
    match candidate {
        SupportWindowCandidate::Oversized => Ok(PreparedSupportWindowCandidate::MetadataOversized),
        SupportWindowCandidate::Item(item) => {
            let encoded = serialize(item)?;
            if encoded.len() > SUPPORT_WINDOW_ITEM_BYTES {
                Ok(PreparedSupportWindowCandidate::EncodedOversized)
            } else {
                Ok(PreparedSupportWindowCandidate::Item(encoded))
            }
        }
    }
}

fn select_bounded_window<T, F>(
    candidates: Vec<SupportWindowCandidate<T>>,
    has_more: bool,
    item_limit: usize,
    response_byte_limit: usize,
    presentation_order: SupportWindowPresentationOrder,
    reverse_for_presentation: bool,
    cancellation: &InterruptibleQuery,
    mut serialize: F,
) -> anyhow::Result<SupportWindowResult>
where
    F: FnMut(T) -> anyhow::Result<Vec<u8>>,
{
    let mut omitted_oversized_items = candidates
        .iter()
        .filter(|candidate| matches!(candidate, SupportWindowCandidate::Oversized))
        .count();
    let mut selected = Vec::with_capacity(candidates.len());
    let mut selected_item_bytes = 0usize;
    let mut byte_excluded = false;

    for candidate in candidates {
        cancellation.check_cancelled()?;
        if selected.len() == item_limit {
            break;
        }
        let item = match prepare_candidate(candidate, cancellation, &mut serialize)? {
            PreparedSupportWindowCandidate::MetadataOversized => continue,
            PreparedSupportWindowCandidate::EncodedOversized => {
                omitted_oversized_items = omitted_oversized_items.saturating_add(1);
                break;
            }
            PreparedSupportWindowCandidate::Item(encoded) => encoded,
        };
        let prospective_count = selected.len() + 1;
        let prospective_item_bytes = selected_item_bytes.saturating_add(item.len());
        let admission_meta = window_meta(
            item_limit,
            response_byte_limit,
            prospective_count,
            omitted_oversized_items,
            presentation_order,
            SupportWindowCompleteness::LimitUncertain,
        );
        if encoded_window_len(&admission_meta, prospective_item_bytes, prospective_count)?
            > response_byte_limit
        {
            byte_excluded = true;
            break;
        }
        selected_item_bytes = prospective_item_bytes;
        selected.push(item);
    }

    let meta = loop {
        let completeness = if has_more || omitted_oversized_items > 0 || byte_excluded {
            SupportWindowCompleteness::LimitUncertain
        } else {
            SupportWindowCompleteness::Complete
        };
        let meta = window_meta(
            item_limit,
            response_byte_limit,
            selected.len(),
            omitted_oversized_items,
            presentation_order,
            completeness,
        );
        if encoded_window_len(&meta, selected_item_bytes, selected.len())? <= response_byte_limit {
            break meta;
        }
        let removed = selected
            .pop()
            .ok_or_else(|| anyhow::anyhow!("support-window metadata exceeds response limit"))?;
        selected_item_bytes = selected_item_bytes.saturating_sub(removed.len());
        byte_excluded = true;
    };
    if reverse_for_presentation {
        selected.reverse();
    }
    cancellation.check_cancelled()?;
    Ok(SupportWindowResult {
        meta,
        items: selected,
    })
}

fn window_meta(
    item_limit: usize,
    response_byte_limit: usize,
    returned_items: usize,
    omitted_oversized_items: usize,
    presentation_order: SupportWindowPresentationOrder,
    completeness: SupportWindowCompleteness,
) -> SupportWindowMeta {
    SupportWindowMeta {
        presentation_order,
        item_limit,
        response_byte_limit,
        returned_items,
        omitted_oversized_items,
        completeness,
    }
}

fn encoded_window_len(
    meta: &SupportWindowMeta,
    item_bytes: usize,
    item_count: usize,
) -> anyhow::Result<usize> {
    let meta_bytes = encoded_meta_len(meta)?;
    Ok(b"{\"window\":".len()
        + meta_bytes
        + b",\"items\":[".len()
        + item_bytes
        + item_count.saturating_sub(1)
        + b"]}".len())
}

fn encoded_meta_len(meta: &SupportWindowMeta) -> anyhow::Result<usize> {
    Ok(serde_json::to_vec(&serde_json::json!({
        "schemaVersion": 1,
        "selection": "newest_matching",
        "presentationOrder": match meta.presentation_order {
            SupportWindowPresentationOrder::UpdatedDescIdAsc => "updated_desc_id_asc",
            SupportWindowPresentationOrder::SeqAsc => "seq_asc",
        },
        "itemLimit": meta.item_limit,
        "responseByteLimit": meta.response_byte_limit,
        "returnedItems": meta.returned_items,
        "omittedOversizedItems": meta.omitted_oversized_items,
        "completeness": match meta.completeness {
            SupportWindowCompleteness::Complete => "complete",
            SupportWindowCompleteness::LimitUncertain => "limit_uncertain",
        },
    }))?
    .len())
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;

    use super::*;

    fn candidate(encoded: impl Into<Vec<u8>>) -> SupportWindowCandidate<Vec<u8>> {
        SupportWindowCandidate::Item(encoded.into())
    }

    fn sized_candidate(bytes: usize) -> SupportWindowCandidate<Vec<u8>> {
        candidate(vec![b'x'; bytes])
    }

    #[test]
    fn complete_empty_window_counts_the_entire_serialized_envelope() {
        let db = crate::persistence::Db::open_in_memory().expect("open DB");
        let (cancellation, guard) = db.begin_interruptible_query();
        let window = select_bounded_window(
            Vec::<SupportWindowCandidate<Vec<u8>>>::new(),
            false,
            3,
            SUPPORT_WINDOW_MIN_RESPONSE_BYTES,
            SupportWindowPresentationOrder::UpdatedDescIdAsc,
            false,
            &cancellation,
            Ok,
        )
        .expect("select empty window");
        guard.disarm();
        assert!(matches!(
            window.meta.completeness,
            SupportWindowCompleteness::Complete
        ));
        assert_eq!(window.meta.returned_items, 0);
        assert!(window.items.is_empty());
        assert!(
            encoded_window_len(&window.meta, 0, 0).unwrap() <= SUPPORT_WINDOW_MIN_RESPONSE_BYTES
        );
    }

    #[test]
    fn oversized_session_candidate_is_omitted_while_bounded_older_session_is_returned() {
        let db = crate::persistence::Db::open_in_memory().expect("open DB");
        let (cancellation, guard) = db.begin_interruptible_query();
        let window = select_bounded_window(
            vec![
                SupportWindowCandidate::Oversized,
                candidate(b"session-older".to_vec()),
            ],
            false,
            2,
            SUPPORT_WINDOW_MIN_RESPONSE_BYTES,
            SupportWindowPresentationOrder::UpdatedDescIdAsc,
            false,
            &cancellation,
            Ok,
        )
        .expect("select bounded window");
        guard.disarm();
        assert!(matches!(
            window.meta.completeness,
            SupportWindowCompleteness::LimitUncertain
        ));
        assert_eq!(window.meta.omitted_oversized_items, 1);
        assert_eq!(window.meta.returned_items, 1);
        assert_eq!(window.items, vec![b"session-older".to_vec()]);
    }

    #[test]
    fn oversized_event_candidate_is_omitted_while_bounded_events_are_presented_ascending() {
        assert_oversized_evidence_candidate_is_omitted(true);
    }

    #[test]
    fn oversized_raw_candidate_is_omitted_while_bounded_notifications_are_presented_ascending() {
        assert_oversized_evidence_candidate_is_omitted(false);
    }

    #[test]
    fn response_byte_exclusion_stops_without_backfilling_an_older_candidate() {
        let db = crate::persistence::Db::open_in_memory().expect("open DB");
        let (cancellation, guard) = db.begin_interruptible_query();
        let encoded_items = Cell::new(0);
        let window = select_bounded_window(
            vec![
                sized_candidate(SUPPORT_WINDOW_MIN_RESPONSE_BYTES),
                candidate(b"older".to_vec()),
            ],
            false,
            2,
            SUPPORT_WINDOW_MIN_RESPONSE_BYTES,
            SupportWindowPresentationOrder::SeqAsc,
            true,
            &cancellation,
            |encoded| {
                encoded_items.set(encoded_items.get() + 1);
                Ok(encoded)
            },
        )
        .expect("select response-bounded evidence window");
        guard.disarm();
        assert!(window.items.is_empty());
        assert_eq!(window.meta.omitted_oversized_items, 0);
        assert!(matches!(
            window.meta.completeness,
            SupportWindowCompleteness::LimitUncertain
        ));
        assert_eq!(encoded_items.get(), 1, "older row must not be encoded");
    }

    #[test]
    fn hard_cap_plus_one_never_returns_more_than_the_requested_item_limit() {
        let db = crate::persistence::Db::open_in_memory().expect("open DB");
        let (cancellation, guard) = db.begin_interruptible_query();
        let window = select_bounded_window(
            vec![candidate(b"2".to_vec()), candidate(b"1".to_vec())],
            true,
            1,
            SUPPORT_WINDOW_MIN_RESPONSE_BYTES,
            SupportWindowPresentationOrder::SeqAsc,
            true,
            &cancellation,
            Ok,
        )
        .expect("select item-bounded evidence window");
        guard.disarm();
        assert_eq!(window.meta.returned_items, 1);
        assert_eq!(window.items.len(), 1);
        assert!(matches!(
            window.meta.completeness,
            SupportWindowCompleteness::LimitUncertain
        ));
    }

    #[test]
    fn post_admission_expansion_stops_shared_selection_without_backfilling() {
        let normalized =
            serde_json::to_vec(&"x".repeat(SUPPORT_WINDOW_ITEM_BYTES)).expect("encode valid JSON");
        assert!(normalized.len() > SUPPORT_WINDOW_ITEM_BYTES);
        for (kind, presentation_order, reverse_for_presentation) in [
            (
                "session",
                SupportWindowPresentationOrder::UpdatedDescIdAsc,
                false,
            ),
            ("event", SupportWindowPresentationOrder::SeqAsc, true),
            ("raw", SupportWindowPresentationOrder::SeqAsc, true),
        ] {
            let db = crate::persistence::Db::open_in_memory().expect("open DB");
            let (cancellation, guard) = db.begin_interruptible_query();
            let encoded_items = Cell::new(0);
            let window = select_bounded_window(
                vec![candidate(b"newest".to_vec()), candidate(b"older".to_vec())],
                false,
                2,
                SUPPORT_WINDOW_MIN_RESPONSE_BYTES,
                presentation_order,
                reverse_for_presentation,
                &cancellation,
                |item| {
                    encoded_items.set(encoded_items.get() + 1);
                    if item.as_slice() == b"newest" {
                        Ok(normalized.clone())
                    } else {
                        Ok(item)
                    }
                },
            )
            .expect("select exact-encoded window");
            guard.disarm();

            assert!(window.items.is_empty(), "{kind}");
            assert_eq!(window.meta.returned_items, 0, "{kind}");
            assert_eq!(window.meta.omitted_oversized_items, 1, "{kind}");
            assert!(
                matches!(
                    window.meta.completeness,
                    SupportWindowCompleteness::LimitUncertain
                ),
                "{kind}"
            );
            assert_eq!(
                encoded_items.get(),
                1,
                "{kind} must not inspect the older row"
            );
        }
    }

    fn assert_oversized_evidence_candidate_is_omitted(is_event: bool) {
        let db = crate::persistence::Db::open_in_memory().expect("open DB");
        let (cancellation, guard) = db.begin_interruptible_query();
        let item = |seq| format!("{}:{seq}", if is_event { "event" } else { "raw" }).into_bytes();
        let window = select_bounded_window(
            vec![
                SupportWindowCandidate::Oversized,
                candidate(item(2)),
                candidate(item(1)),
            ],
            false,
            3,
            SUPPORT_WINDOW_MIN_RESPONSE_BYTES,
            SupportWindowPresentationOrder::SeqAsc,
            true,
            &cancellation,
            Ok,
        )
        .expect("select bounded evidence window");
        guard.disarm();
        assert!(matches!(
            window.meta.completeness,
            SupportWindowCompleteness::LimitUncertain
        ));
        assert_eq!(window.meta.omitted_oversized_items, 1);
        assert_eq!(window.meta.returned_items, 2);
        let seqs = window
            .items
            .iter()
            .map(|item| {
                std::str::from_utf8(item)
                    .expect("UTF-8 item")
                    .rsplit_once(':')
                    .expect("sequence suffix")
                    .1
                    .parse::<i64>()
                    .expect("numeric sequence")
            })
            .collect::<Vec<_>>();
        assert_eq!(seqs, vec![1, 2]);
    }
}
