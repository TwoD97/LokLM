use crate::{Error, Result};
use std::sync::{
    Arc,
    atomic::{AtomicBool, AtomicU64, Ordering},
};

/// Revocation is independent of storage mutexes and takes effect immediately.
/// Workers must check before committing and the UI must reject late epochs.
#[derive(Clone, Default)]
pub struct Sessions {
    // One atomic word: epoch in upper bits, unlocked in bit zero. A separate
    // open flag could briefly resurrect an old unlock during revocation.
    state: Arc<AtomicU64>,
}
#[derive(Clone)]
pub struct Ticket {
    epoch: u64,
    sessions: Sessions,
    cancelled: Arc<AtomicBool>,
}
impl Sessions {
    pub fn revoke(&self) {
        let _ = self
            .state
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |s| {
                Some(((s >> 1).wrapping_add(1)) << 1)
            });
    }
    pub fn epoch(&self) -> u64 {
        self.state.load(Ordering::SeqCst) >> 1
    }
    pub fn publish(&self, expected: u64) -> Result<()> {
        self.state
            .compare_exchange(
                expected << 1,
                (expected << 1) | 1,
                Ordering::SeqCst,
                Ordering::SeqCst,
            )
            .map(|_| ())
            .map_err(|_| Error::Revoked)
    }
    pub fn ticket(&self) -> Result<Ticket> {
        let ticket = Ticket {
            epoch: self.epoch(),
            sessions: self.clone(),
            cancelled: Arc::new(AtomicBool::new(false)),
        };
        ticket.check()?;
        Ok(ticket)
    }
}
impl Ticket {
    pub fn epoch(&self) -> u64 {
        self.epoch
    }
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }
    pub fn check(&self) -> Result<()> {
        if self.cancelled.load(Ordering::SeqCst)
            || self.sessions.state.load(Ordering::SeqCst) != (self.epoch << 1) | 1
        {
            return Err(Error::Revoked);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stale_work_and_pending_unlock_stay_revoked() {
        let sessions = Sessions::default();
        let old = sessions.epoch();
        sessions.publish(old).unwrap();
        let t = sessions.ticket().unwrap();
        sessions.revoke();
        assert!(t.check().is_err());
        assert!(sessions.publish(old).is_err());
        sessions.publish(sessions.epoch()).unwrap();
        assert!(t.check().is_err());
        let current = sessions.ticket().unwrap();
        current.cancel();
        assert!(current.check().is_err());
    }
}
