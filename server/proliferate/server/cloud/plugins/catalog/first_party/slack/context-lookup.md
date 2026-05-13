# Slack context lookup

Use Slack only as a source of workspace conversation context unless the user explicitly requests a Slack action.

1. Identify the likely channel, thread, user, date range, or search terms.
2. Search narrowly and fetch the minimum message context needed to answer.
3. Preserve channel ids, thread timestamps, message timestamps, and permalinks returned by tools.
4. When reporting results, cite the channel or thread and distinguish quoted facts from your interpretation.
5. Do not send messages, schedule messages, create canvases, or modify Slack state unless the user asks and the mounted tools and scopes support it.
