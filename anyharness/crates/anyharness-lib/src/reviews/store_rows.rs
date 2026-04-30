use rusqlite::params;

use super::model::{
    ReviewAssignmentRecord, ReviewAssignmentStatus, ReviewFeedbackJobRecord,
    ReviewFeedbackJobState, ReviewKind, ReviewModeVerificationStatus, ReviewParseError,
    ReviewRoundRecord, ReviewRoundStatus, ReviewRunRecord, ReviewRunStatus,
};

pub(super) fn insert_run(
    conn: &rusqlite::Connection,
    run: &ReviewRunRecord,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO review_runs (
            id, workspace_id, parent_session_id, kind, status, target_plan_id,
            target_plan_snapshot_hash, target_code_manifest_json, title, max_rounds,
            auto_send_feedback, active_round_id, current_round_number,
            parent_can_signal_revision_via_mcp, failure_reason, failure_detail,
            stopped_at, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
        params![
            run.id,
            run.workspace_id,
            run.parent_session_id,
            run.kind.as_str(),
            run.status.as_str(),
            run.target_plan_id,
            run.target_plan_snapshot_hash,
            run.target_code_manifest_json,
            run.title,
            run.max_rounds,
            if run.auto_send_feedback { 1 } else { 0 },
            run.active_round_id,
            run.current_round_number,
            if run.parent_can_signal_revision_via_mcp { 1 } else { 0 },
            run.failure_reason,
            run.failure_detail,
            run.stopped_at,
            run.created_at,
            run.updated_at,
        ],
    )?;
    Ok(())
}

pub(super) fn insert_round(
    conn: &rusqlite::Connection,
    round: &ReviewRoundRecord,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO review_rounds (
            id, review_run_id, round_number, status, target_plan_id,
            target_plan_snapshot_hash, target_code_manifest_json, feedback_job_id,
            feedback_prompt_sent_at, completed_at, failure_reason, failure_detail,
            created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        params![
            round.id,
            round.review_run_id,
            round.round_number,
            round.status.as_str(),
            round.target_plan_id,
            round.target_plan_snapshot_hash,
            round.target_code_manifest_json,
            round.feedback_job_id,
            round.feedback_prompt_sent_at,
            round.completed_at,
            round.failure_reason,
            round.failure_detail,
            round.created_at,
            round.updated_at,
        ],
    )?;
    Ok(())
}

pub(super) fn insert_assignment(
    conn: &rusqlite::Connection,
    assignment: &ReviewAssignmentRecord,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO review_assignments (
            id, review_run_id, review_round_id, reviewer_session_id, session_link_id,
            persona_id, persona_label, persona_prompt, agent_kind, model_id,
            requested_mode_id, actual_mode_id, mode_verification_status, status,
            pass, summary, critique_markdown, critique_artifact_path, submitted_at, deadline_at,
            reminder_count, failure_reason, failure_detail, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25)",
        params![
            assignment.id,
            assignment.review_run_id,
            assignment.review_round_id,
            assignment.reviewer_session_id,
            assignment.session_link_id,
            assignment.persona_id,
            assignment.persona_label,
            assignment.persona_prompt,
            assignment.agent_kind,
            assignment.model_id,
            assignment.requested_mode_id,
            assignment.actual_mode_id,
            assignment.mode_verification_status.as_str(),
            assignment.status.as_str(),
            assignment.pass.map(|value| if value { 1 } else { 0 }),
            assignment.summary,
            assignment.critique_markdown,
            assignment.critique_artifact_path,
            assignment.submitted_at,
            assignment.deadline_at,
            assignment.reminder_count,
            assignment.failure_reason,
            assignment.failure_detail,
            assignment.created_at,
            assignment.updated_at,
        ],
    )?;
    Ok(())
}

pub(super) fn insert_feedback_job(
    conn: &rusqlite::Connection,
    job: &ReviewFeedbackJobRecord,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO review_feedback_jobs (
            id, review_run_id, review_round_id, parent_session_id, state, prompt_text,
            attempt_count, next_attempt_at, sent_prompt_seq, feedback_turn_id, failure_reason,
            failure_detail, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        params![
            job.id,
            job.review_run_id,
            job.review_round_id,
            job.parent_session_id,
            job.state.as_str(),
            job.prompt_text,
            job.attempt_count,
            job.next_attempt_at,
            job.sent_prompt_seq,
            job.feedback_turn_id,
            job.failure_reason,
            job.failure_detail,
            job.created_at,
            job.updated_at,
        ],
    )?;
    Ok(())
}

pub(super) fn map_run(row: &rusqlite::Row) -> rusqlite::Result<ReviewRunRecord> {
    let kind: String = row.get("kind")?;
    let status: String = row.get("status")?;
    Ok(ReviewRunRecord {
        id: row.get("id")?,
        workspace_id: row.get("workspace_id")?,
        parent_session_id: row.get("parent_session_id")?,
        kind: parse_review_kind(&kind)?,
        status: parse_run_status(&status)?,
        target_plan_id: row.get("target_plan_id")?,
        target_plan_snapshot_hash: row.get("target_plan_snapshot_hash")?,
        target_code_manifest_json: row.get("target_code_manifest_json")?,
        title: row.get("title")?,
        max_rounds: row.get::<_, i64>("max_rounds")?.try_into().unwrap_or(0),
        auto_send_feedback: row.get::<_, i64>("auto_send_feedback")? != 0,
        active_round_id: row.get("active_round_id")?,
        current_round_number: row
            .get::<_, i64>("current_round_number")?
            .try_into()
            .unwrap_or(0),
        parent_can_signal_revision_via_mcp: row
            .get::<_, i64>("parent_can_signal_revision_via_mcp")?
            != 0,
        failure_reason: row.get("failure_reason")?,
        failure_detail: row.get("failure_detail")?,
        stopped_at: row.get("stopped_at")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

pub(super) fn map_round(row: &rusqlite::Row) -> rusqlite::Result<ReviewRoundRecord> {
    let status: String = row.get("status")?;
    Ok(ReviewRoundRecord {
        id: row.get("id")?,
        review_run_id: row.get("review_run_id")?,
        round_number: row.get::<_, i64>("round_number")?.try_into().unwrap_or(0),
        status: parse_round_status(&status)?,
        target_plan_id: row.get("target_plan_id")?,
        target_plan_snapshot_hash: row.get("target_plan_snapshot_hash")?,
        target_code_manifest_json: row.get("target_code_manifest_json")?,
        feedback_job_id: row.get("feedback_job_id")?,
        feedback_prompt_sent_at: row.get("feedback_prompt_sent_at")?,
        completed_at: row.get("completed_at")?,
        failure_reason: row.get("failure_reason")?,
        failure_detail: row.get("failure_detail")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

pub(super) fn map_assignment(row: &rusqlite::Row) -> rusqlite::Result<ReviewAssignmentRecord> {
    let mode_status: String = row.get("mode_verification_status")?;
    let status: String = row.get("status")?;
    Ok(ReviewAssignmentRecord {
        id: row.get("id")?,
        review_run_id: row.get("review_run_id")?,
        review_round_id: row.get("review_round_id")?,
        reviewer_session_id: row.get("reviewer_session_id")?,
        session_link_id: row.get("session_link_id")?,
        persona_id: row.get("persona_id")?,
        persona_label: row.get("persona_label")?,
        persona_prompt: row.get("persona_prompt")?,
        agent_kind: row.get("agent_kind")?,
        model_id: row.get("model_id")?,
        requested_mode_id: row.get("requested_mode_id")?,
        actual_mode_id: row.get("actual_mode_id")?,
        mode_verification_status: parse_mode_status(&mode_status)?,
        status: parse_assignment_status(&status)?,
        pass: row.get::<_, Option<i64>>("pass")?.map(|value| value != 0),
        summary: row.get("summary")?,
        critique_markdown: row.get("critique_markdown")?,
        critique_artifact_path: row.get("critique_artifact_path")?,
        submitted_at: row.get("submitted_at")?,
        deadline_at: row.get("deadline_at")?,
        reminder_count: row.get::<_, i64>("reminder_count")?.try_into().unwrap_or(0),
        failure_reason: row.get("failure_reason")?,
        failure_detail: row.get("failure_detail")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

pub(super) fn map_feedback_job(row: &rusqlite::Row) -> rusqlite::Result<ReviewFeedbackJobRecord> {
    let state: String = row.get("state")?;
    Ok(ReviewFeedbackJobRecord {
        id: row.get("id")?,
        review_run_id: row.get("review_run_id")?,
        review_round_id: row.get("review_round_id")?,
        parent_session_id: row.get("parent_session_id")?,
        state: parse_feedback_state(&state)?,
        prompt_text: row.get("prompt_text")?,
        attempt_count: row.get::<_, i64>("attempt_count")?.try_into().unwrap_or(0),
        next_attempt_at: row.get("next_attempt_at")?,
        sent_prompt_seq: row.get("sent_prompt_seq")?,
        feedback_turn_id: row.get("feedback_turn_id")?,
        failure_reason: row.get("failure_reason")?,
        failure_detail: row.get("failure_detail")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn parse_review_kind(value: &str) -> rusqlite::Result<ReviewKind> {
    ReviewKind::parse(value).map_err(map_parse_error)
}

fn parse_run_status(value: &str) -> rusqlite::Result<ReviewRunStatus> {
    ReviewRunStatus::parse(value).map_err(map_parse_error)
}

fn parse_round_status(value: &str) -> rusqlite::Result<ReviewRoundStatus> {
    ReviewRoundStatus::parse(value).map_err(map_parse_error)
}

fn parse_assignment_status(value: &str) -> rusqlite::Result<ReviewAssignmentStatus> {
    ReviewAssignmentStatus::parse(value).map_err(map_parse_error)
}

fn parse_mode_status(value: &str) -> rusqlite::Result<ReviewModeVerificationStatus> {
    ReviewModeVerificationStatus::parse(value).map_err(map_parse_error)
}

fn parse_feedback_state(value: &str) -> rusqlite::Result<ReviewFeedbackJobState> {
    ReviewFeedbackJobState::parse(value).map_err(map_parse_error)
}

fn map_parse_error(error: ReviewParseError) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
}
