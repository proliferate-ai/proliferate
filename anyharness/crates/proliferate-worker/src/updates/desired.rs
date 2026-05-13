use crate::error::Result;
use crate::store::Store;
use crate::updates::UpdateStatusReport;

pub fn current_reports(store: &Store) -> Result<Vec<UpdateStatusReport>> {
    let mut reports = Vec::new();
    if let Some(worker) = store.load_update_state("proliferate-worker")? {
        reports.push(UpdateStatusReport {
            component: worker.component,
            installed_version: worker.installed_version,
            desired_version: worker.desired_version,
            staged_path: worker.staged_path,
            status: worker.status,
        });
    }
    Ok(reports)
}
