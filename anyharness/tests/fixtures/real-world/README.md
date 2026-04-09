# Real-World Session Fixtures

Store sanitized `SessionEventEnvelope[]` exports here when a production or staging
session reproduces a transcript, resume, or presentation bug.

Fixture rules:

- Keep the JSON array in the exact shape returned by `GET /v1/sessions/{id}/events`.
- Remove prompts, secrets, repository names, absolute paths, and file contents
  if they are not required for the bug.
- Add one reducer replay test and one resume/reconnect equivalence test for
  each fixture.
