WITH prompt_sequences AS (
    SELECT session_id, seq
    FROM session_pending_prompts

    UNION ALL

    SELECT
        session_id,
        json_extract(
            CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,
            '$.seq'
        )
    FROM session_events
    WHERE event_type IN (
        'pending_prompt_added',
        'pending_prompt_updated',
        'pending_prompt_removed'
    )
      AND json_extract(
          CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,
          '$.type'
      ) = event_type
      AND json_type(
          CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,
          '$.seq'
      ) = 'integer'

    UNION ALL

    SELECT
        events.session_id,
        json_extract(
            CASE WHEN json_valid(entries.value) THEN entries.value ELSE '{}' END,
            '$.seq'
        )
    FROM session_events AS events
    JOIN json_each(
        CASE WHEN json_valid(events.payload_json)
            THEN events.payload_json
            ELSE '{"pendingPrompts":[]}'
        END,
        '$.pendingPrompts'
    ) AS entries
    WHERE events.event_type = 'pending_prompts_reordered'
      AND json_extract(
          CASE WHEN json_valid(events.payload_json) THEN events.payload_json ELSE '{}' END,
          '$.type'
      ) = events.event_type
      AND json_type(
          CASE WHEN json_valid(entries.value) THEN entries.value ELSE '{}' END,
          '$.seq'
      ) = 'integer'

    UNION ALL

    SELECT links.parent_session_id, completions.parent_prompt_seq
    FROM session_link_completions AS completions
    JOIN session_links AS links ON links.id = completions.session_link_id
    WHERE completions.parent_prompt_seq IS NOT NULL

    UNION ALL

    SELECT parent_session_id, parent_prompt_seq
    FROM session_link_completion_deliveries
    WHERE parent_prompt_seq IS NOT NULL

    UNION ALL

    SELECT parent_session_id, retired_prompt_seq
    FROM session_link_completion_deliveries
    WHERE retired_prompt_seq IS NOT NULL

    UNION ALL

    SELECT parent_session_id, sent_prompt_seq
    FROM review_feedback_jobs
    WHERE sent_prompt_seq IS NOT NULL
), prompt_sequence_maxima AS (
    SELECT session_id, MAX(seq) AS max_seq
    FROM prompt_sequences
    WHERE typeof(seq) = 'integer'
      AND seq > 0
      AND seq < 9223372036854775807
    GROUP BY session_id
)
UPDATE sessions
SET pending_prompt_seq_cursor = MAX(
    pending_prompt_seq_cursor,
    COALESCE((
        SELECT max_seq
        FROM prompt_sequence_maxima
        WHERE prompt_sequence_maxima.session_id = sessions.id
    ), 0)
);
