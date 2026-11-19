//! Runs the production pipe/job/cancellation boundary without Tauri or models.
fn main() {
    if std::env::args().nth(1).as_deref() == Some(loklm_documents::WORKER_ARGUMENT) {
        std::process::exit(loklm_documents::worker_main());
    }
    let sessions = loklm_core::session::Sessions::default();
    sessions.publish(sessions.epoch()).unwrap();
    let ticket = sessions.ticket().unwrap();
    if std::env::args().nth(1).as_deref() == Some("--stress") {
        let bytes = std::fs::read(std::env::args().nth(2).expect("synthetic PDF path")).unwrap();
        let started = std::time::Instant::now();
        assert!(loklm_documents::parse_isolated(&bytes, &ticket).is_err());
        assert!(started.elapsed() < std::time::Duration::from_secs(35));
        let cancel = ticket.clone();
        let canceller = std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(50));
            cancel.cancel();
        });
        let started = std::time::Instant::now();
        assert!(matches!(
            loklm_documents::parse_isolated(&bytes, &ticket),
            Err(loklm_core::Error::Revoked)
        ));
        canceller.join().unwrap();
        assert!(started.elapsed() < std::time::Duration::from_secs(2));
        let ticket = sessions.ticket().unwrap();
        let lock = sessions.clone();
        let locker = std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(50));
            lock.revoke();
        });
        assert!(matches!(
            loklm_documents::parse_isolated(&bytes, &ticket),
            Err(loklm_core::Error::Revoked)
        ));
        locker.join().unwrap();
        println!(
            "Isolated synthetic expansion PDF rejected; concurrent cancel and session lock stopped and reaped workers"
        );
        return;
    }
    let pdf =
        loklm_documents::parse_isolated(include_bytes!("../tests/fixtures/synthetic.pdf"), &ticket)
            .unwrap();
    assert_eq!(pdf.pages.len(), 2);
    assert_eq!(pdf.pages[0].0, 1);
    assert!(pdf.pages[0].1.contains("Grüße aus Köln"));
    assert_eq!(pdf.pages[1].0, 2);
    assert!(pdf.pages[1].1.contains("ALPHA-47"));
    for bytes in [
        include_bytes!("../tests/fixtures/broken-page.pdf").as_slice(),
        include_bytes!("../tests/fixtures/blank-page.pdf"),
        include_bytes!("../tests/fixtures/image.pdf"),
    ] {
        assert!(loklm_documents::parse_isolated(bytes, &ticket).is_err());
    }
    ticket.cancel();
    assert!(
        loklm_documents::parse_isolated(include_bytes!("../tests/fixtures/synthetic.pdf"), &ticket)
            .is_err()
    );
    println!(
        "Isolated PDF: two-page DE/EN, malformed later page, blank/OCR, image and pre-cancellation checks passed"
    );
}
