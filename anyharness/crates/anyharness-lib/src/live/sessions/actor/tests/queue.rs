use super::*;

#[tokio::test]
async fn accepted_mailbox_command_wins_over_idle_queue_drain() {
    let (command_tx, mut command_rx) = mpsc::channel(1);
    command_tx
        .send(SessionCommand::Cancel)
        .await
        .expect("queue command");
    let (_notification_tx, mut notification_rx) = mpsc::unbounded_channel();
    let (_background_tx, mut background_rx) = mpsc::unbounded_channel();

    let selected = select_idle_work(
        &mut command_rx,
        &mut notification_rx,
        &mut background_rx,
        true,
        None,
    )
    .await;

    assert!(matches!(
        selected,
        IdleWork::Command(Some(SessionCommand::Cancel))
    ));
}

#[tokio::test]
async fn idle_queue_drain_runs_when_mailbox_has_no_accepted_command() {
    let (_command_tx, mut command_rx) = mpsc::channel(1);
    let (_notification_tx, mut notification_rx) = mpsc::unbounded_channel();
    let (_background_tx, mut background_rx) = mpsc::unbounded_channel();

    let selected = select_idle_work(
        &mut command_rx,
        &mut notification_rx,
        &mut background_rx,
        true,
        None,
    )
    .await;

    assert!(matches!(selected, IdleWork::DrainQueuedPrompt));
}

#[tokio::test(start_paused = true)]
async fn cold_start_grace_accepts_command_sent_after_actor_loop_begins() {
    let (command_tx, mut command_rx) = mpsc::channel(1);
    let (_notification_tx, mut notification_rx) = mpsc::unbounded_channel();
    let (_background_tx, mut background_rx) = mpsc::unbounded_channel();
    let drain_deadline = tokio::time::Instant::now() + STARTUP_QUEUE_DRAIN_GRACE;

    tokio::spawn(async move {
        tokio::time::sleep(STARTUP_QUEUE_DRAIN_GRACE / 2).await;
        command_tx
            .send(SessionCommand::Cancel)
            .await
            .expect("send cold-start command");
    });

    let selected = select_idle_work(
        &mut command_rx,
        &mut notification_rx,
        &mut background_rx,
        true,
        Some(drain_deadline),
    )
    .await;

    assert!(matches!(
        selected,
        IdleWork::Command(Some(SessionCommand::Cancel))
    ));
}
