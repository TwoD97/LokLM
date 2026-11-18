use crate::{Error, Result};
use std::sync::{
    Arc,
    atomic::{AtomicBool, AtomicU64, Ordering},
};

/// Revocation is independent of storage mutexes and takes effect immediately.
/// Workers must check before committing and the UI must reject late epochs.
#[derive(Clone, Default)]
pub struct Sessions {
    epoch: Arc<AtomicU64>,
    open: Arc<AtomicBool>,
}
#[derive(Clone)]
pub struct Ticket {
    epoch: u64,
    sessions: Sessions,
    cancelled: Arc<AtomicBool>,
}
impl Sessions {
    pub fn revoke(&self) {
        self.open.store(false, Ordering::SeqCst);
        self.epoch.fetch_add(1, Ordering::SeqCst);
    }
    pub fn epoch(&self) -> u64 {
        self.epoch.load(Ordering::SeqCst)
    }
    pub fn publish(&self, expected: u64) -> Result<()> {
        if self.epoch() != expected {
            return Err(Error::Revoked);
        }
        self.open.store(true, Ordering::SeqCst);
        // Paired with the admission check in ticket; never resurrect a stale epoch.
        if self.epoch() != expected {
            self.open.store(false, Ordering::SeqCst);
            return Err(Error::Revoked);
        }
        Ok(())
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
            || !self.sessions.open.load(Ordering::SeqCst)
            || self.sessions.epoch() != self.epoch
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
