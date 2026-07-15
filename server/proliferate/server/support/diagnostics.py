"""Server-owned support cloud diagnostics collection.

DISABLED: the cloud-workspace diagnostics enrichment this module performed
queried the cloud target / runtime-access / sandbox / exposure tables and the
`support_diagnostics` store, all of which were removed in the sandbox-model
cutover (#803/#846). The desktop client uploads its own diagnostics bundle
(logs, sessions, config) directly to S3, so support reports still carry
diagnostics — only the extra server-side cloud enrichment is gone.

`create_support_report` now always sets cloud_diagnostics_status to
"not_applicable" (see service._authorized_cloud_refs), so the after-commit job
below is never scheduled. The function is kept as a no-op guard: if a report
ever reaches here it simply marks itself not-applicable rather than crashing.

To revive server-side cloud enrichment, restore a store over whatever tables
replace the deleted sandbox/target models and reinstate the collection body
from git history (pre-#846).
"""

from __future__ import annotations

import logging

from proliferate.db.engine import async_session_factory
from proliferate.db.store import support_reports

logger = logging.getLogger(__name__)


async def collect_cloud_diagnostics_for_report(report_id: str) -> None:
    async with async_session_factory() as db, db.begin():
        report = await support_reports.get_report_by_id(db, report_id)
        if report is None or report.cloud_diagnostics_status == "not_applicable":
            return
        await support_reports.mark_cloud_diagnostics_status(
            db,
            report_id=report_id,
            status="not_applicable",
            error=None,
        )
