//! Agent-auth status wire <-> domain mappers (the agents_contract.rs pattern):
//! dep-less, sync, decisionless. The domain persists and publishes its own
//! `status::StatusDoc`; this is the one place it becomes the wire's
//! `AgentAuthStatusDoc`. Both shapes serialize to the spec's printed
//! snake_case document, so the mapping is field-for-field.

use anyharness_contract::v1::{
    AgentAuthAppliedMethod, AgentAuthMethodRow, AgentAuthProbeStatus, AgentAuthProbeVerdict,
    AgentAuthStatusDoc,
};

use crate::domains::agents::status::{
    AppliedMethod, MethodRow, ProbeStatus, ProbeVerdict, StatusDoc,
};

pub(crate) fn status_doc_to_contract(doc: StatusDoc) -> AgentAuthStatusDoc {
    AgentAuthStatusDoc {
        harness_kind: doc.harness_kind,
        methods: doc
            .methods
            .into_iter()
            .map(method_row_to_contract)
            .collect(),
        applied: doc.applied.map(applied_method_to_contract),
        next_seat_id: doc.next_seat_id,
        rotate: doc.rotate,
        probe: probe_status_to_contract(doc.probe),
        cooling_until: doc.cooling_until,
    }
}

pub(crate) fn method_row_to_contract(row: MethodRow) -> AgentAuthMethodRow {
    AgentAuthMethodRow {
        kind: row.kind,
        available: row.available,
        seat_id: row.seat_id,
        applied: row.applied,
        detected: row.detected,
        offer: row.offer,
    }
}

fn applied_method_to_contract(applied: AppliedMethod) -> AgentAuthAppliedMethod {
    AgentAuthAppliedMethod {
        kind: applied.kind,
        seat_id: applied.seat_id,
    }
}

fn probe_status_to_contract(probe: ProbeStatus) -> AgentAuthProbeStatus {
    AgentAuthProbeStatus {
        verdict: match probe.verdict {
            ProbeVerdict::Verified => AgentAuthProbeVerdict::Verified,
            ProbeVerdict::Failed => AgentAuthProbeVerdict::Failed,
            ProbeVerdict::Unverified => AgentAuthProbeVerdict::Unverified,
        },
        at: probe.at,
        stale: probe.stale,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The two shapes are twins on the wire: the domain document and its
    /// mapped contract document serialize to identical JSON, so the persisted
    /// row IS the wire body.
    #[test]
    fn domain_and_contract_documents_serialize_identically() {
        let doc = StatusDoc {
            harness_kind: "claude".to_string(),
            methods: vec![
                MethodRow {
                    kind: "seat".to_string(),
                    available: Some(true),
                    seat_id: Some("seat-a".to_string()),
                    applied: true,
                    detected: None,
                    offer: None,
                },
                MethodRow {
                    kind: "native".to_string(),
                    available: None,
                    seat_id: None,
                    applied: false,
                    detected: Some(true),
                    offer: Some("mint_seat".to_string()),
                },
            ],
            applied: Some(AppliedMethod {
                kind: "seat".to_string(),
                seat_id: Some("seat-a".to_string()),
            }),
            next_seat_id: Some("seat-b".to_string()),
            rotate: true,
            probe: ProbeStatus {
                verdict: ProbeVerdict::Verified,
                at: Some("2026-08-27T10:00:00+00:00".to_string()),
                stale: false,
            },
            cooling_until: None,
        };
        let domain_json = serde_json::to_value(&doc).expect("domain serializes");
        let contract_json =
            serde_json::to_value(status_doc_to_contract(doc)).expect("contract serializes");
        assert_eq!(domain_json, contract_json);
        // The spec's print: null fields serialize as null, never vanish.
        assert!(contract_json
            .get("cooling_until")
            .is_some_and(|v| v.is_null()));
    }
}
