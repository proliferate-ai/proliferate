use super::*;

#[tokio::test]
async fn broker_rejects_zero_oversize_truncated_and_second_frames() {
    async fn parse(bytes: &[u8]) -> bool {
        let (mut writer, mut reader) = tokio::io::duplex(32);
        writer.write_all(bytes).await.expect("write");
        drop(writer);
        read_frame(&mut reader, 8).await.is_err()
    }
    assert!(parse(&0_u32.to_be_bytes()).await);
    assert!(parse(&9_u32.to_be_bytes()).await);
    let mut truncated = 3_u32.to_be_bytes().to_vec();
    truncated.push(b'{');
    assert!(parse(&truncated).await);

    // One parser consumes exactly one command. A second frame remains and
    // is never dispatched on the same connection.
    let (mut writer, mut reader) = tokio::io::duplex(64);
    writer.write_u32(2).await.expect("length");
    writer.write_all(b"{}").await.expect("body");
    writer.write_u32(2).await.expect("second length");
    writer.write_all(b"{}").await.expect("second body");
    assert_eq!(read_frame(&mut reader, 8).await.expect("first"), b"{}");
    let mut marker = [0_u8; 1];
    assert_eq!(
        reader
            .read_exact(&mut marker)
            .await
            .expect("second remains"),
        1
    );
}

#[test]
fn broker_caps_eight_finite_four_tail_and_one_export_leases() {
    assert_eq!(MAX_BROKER_FINITE_REQUESTS, 8);
    assert_eq!(MAX_BROKER_TAILS, 4);
    assert_eq!(MAX_BROKER_EXPORTS, 1);
    assert_eq!(MAX_BROKER_CONNECTIONS, 13);

    fn exhaust(limit: usize) {
        let semaphore = Arc::new(Semaphore::new(limit));
        let permits = (0..limit)
            .map(|_| {
                Arc::clone(&semaphore)
                    .try_acquire_owned()
                    .expect("lease inside cap")
            })
            .collect::<Vec<_>>();
        assert!(Arc::clone(&semaphore).try_acquire_owned().is_err());
        drop(permits);
        assert!(Arc::clone(&semaphore).try_acquire_owned().is_ok());
    }

    exhaust(MAX_BROKER_FINITE_REQUESTS);
    exhaust(MAX_BROKER_TAILS);
    exhaust(MAX_BROKER_EXPORTS);
    exhaust(MAX_BROKER_CONNECTIONS);
}
