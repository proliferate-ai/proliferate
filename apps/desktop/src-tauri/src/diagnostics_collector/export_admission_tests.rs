use std::sync::Arc;

use super::ExportAdmission;

#[test]
fn shared_owner_has_exactly_one_non_queueing_slot() {
    let admission = ExportAdmission::shared_capacity_one();
    let permit = Arc::clone(&admission)
        .try_acquire_owned()
        .expect("first export admitted");
    assert!(Arc::clone(&admission).try_acquire_owned().is_err());
    drop(permit);
    assert!(Arc::clone(&admission).try_acquire_owned().is_ok());
}

#[test]
fn all_clones_contend_for_the_same_slot() {
    let broker_owner = ExportAdmission::shared_capacity_one();
    let support_owner = Arc::clone(&broker_owner);
    let permit = broker_owner
        .try_acquire_owned()
        .expect("broker export admitted");
    assert!(support_owner.try_acquire_owned().is_err());
    drop(permit);
}
