//! Stage a complete payload beside its destination before replacing an install.
//! A journal and the previous directory allow retry after process interruption.
//! This does not promise payload durability across power loss.
//! Model files move on the same volume; they are never copied or discarded by
//! payload rollback. This is not a transaction for external shortcuts/registry.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

pub struct PayloadUpdate {
    destination: PathBuf,
    directory: PathBuf,
    keep_models: bool,
    executable: PathBuf,
    had_previous: bool,
    _lock: File,
    settled: bool,
}

fn plain_directory(path: &Path) -> io::Result<bool> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.is_dir() && !meta.file_type().is_symlink() => Ok(true),
        Ok(_) => Err(io::Error::other(
            "Install paths must be ordinary directories",
        )),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error),
    }
}

fn path_present(path: &Path) -> io::Result<bool> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error),
    }
}

// Ordinary Unix rename may replace an existing empty directory. Publication
// must instead fail without altering even an unrelated empty journal.
#[cfg(windows)]
fn publish_directory(source: &Path, destination: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn MoveFileExW(existing: *const u16, new: *const u16, flags: u32) -> i32;
    }
    let wide = |path: &Path| -> io::Result<Vec<u16>> {
        let mut value: Vec<_> = path.as_os_str().encode_wide().collect();
        if value.contains(&0) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Path contains a null character",
            ));
        }
        value.push(0);
        Ok(value)
    };
    let source = wide(source)?;
    let destination = wide(destination)?;
    // SAFETY: both terminated UTF-16 buffers remain alive through the call.
    // No MOVEFILE_REPLACE_EXISTING or copy-across-volume fallback is requested.
    let result = unsafe { MoveFileExW(source.as_ptr(), destination.as_ptr(), 0) };
    if result != 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn publish_directory(source: &Path, destination: &Path) -> io::Result<()> {
    use std::ffi::{c_char, c_int, c_uint, CString};
    use std::os::unix::ffi::OsStrExt;
    let source = CString::new(source.as_os_str().as_bytes())?;
    let destination = CString::new(destination.as_os_str().as_bytes())?;
    #[cfg(target_os = "linux")]
    unsafe extern "C" {
        fn renameat2(
            from_fd: c_int,
            from: *const c_char,
            to_fd: c_int,
            to: *const c_char,
            flags: c_uint,
        ) -> c_int;
    }
    #[cfg(target_os = "macos")]
    unsafe extern "C" {
        fn renamex_np(from: *const c_char, to: *const c_char, flags: c_uint) -> c_int;
    }
    // SAFETY: both C strings remain alive through the call. AT_FDCWD=-100
    // and RENAME_NOREPLACE=1 are Linux ABI constants; RENAME_EXCL=4 is Darwin's.
    // Unsupported filesystem operations fail closed; never fall back to rename.
    #[cfg(target_os = "linux")]
    let result = unsafe { renameat2(-100, source.as_ptr(), -100, destination.as_ptr(), 1) };
    #[cfg(target_os = "macos")]
    let result = unsafe { renamex_np(source.as_ptr(), destination.as_ptr(), 4) };
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

fn initialization_directory(directory: &Path) -> io::Result<PathBuf> {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    for _ in 0..128 {
        let mut name = directory.file_name().unwrap().to_os_string();
        name.push(format!(
            ".init-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let temporary = directory.with_file_name(name);
        match fs::create_dir(&temporary) {
            Ok(()) => return Ok(temporary),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }
    Err(io::Error::other(
        "Could not reserve an update initialization directory",
    ))
}

fn validate_journal(directory: &Path, identity: &[u8]) -> io::Result<()> {
    plain_directory(directory)?;
    let owner = directory.join("owner");
    if !fs::symlink_metadata(&owner)?.file_type().is_file() || fs::read(&owner)? != identity {
        return Err(io::Error::other(
            "An unrelated folder occupies the update journal path",
        ));
    }
    Ok(())
}

fn initialize_journal(directory: &Path, identity: &[u8]) -> io::Result<()> {
    if path_present(directory)? {
        return validate_journal(directory, identity);
    }
    // A process exit here can leave only an unpublished sibling. Future
    // attempts do not adopt or delete it, and the destination is untouched.
    let temporary = initialization_directory(directory)?;
    let result = (|| {
        let mut owner = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(temporary.join("owner"))?;
        owner.write_all(identity)?;
        owner.sync_all()?;
        drop(owner);
        publish_directory(&temporary, directory)
    })();
    // Only this invocation's newly created directory is eligible for cleanup.
    if plain_directory(&temporary).unwrap_or(false) {
        let _ = fs::remove_dir_all(&temporary);
    }
    match result {
        Ok(()) => Ok(()),
        Err(_) if path_present(directory)? => validate_journal(directory, identity),
        Err(error) => Err(error),
    }
}

fn write_durable(path: &Path, contents: &[u8]) -> io::Result<()> {
    let temporary = path.with_extension("tmp");
    // These files live only inside the verified, exclusively locked journal.
    if fs::symlink_metadata(&temporary).is_ok_and(|meta| meta.file_type().is_symlink()) {
        return Err(io::Error::other("Unexpected journal link"));
    }
    let mut file = File::create(&temporary)?;
    file.write_all(contents)?;
    file.sync_all()?;
    drop(file);
    fs::rename(&temporary, path)?;
    #[cfg(unix)]
    File::open(path.parent().unwrap())?.sync_all()?;
    Ok(())
}

impl PayloadUpdate {
    pub fn prepare(
        destination: &Path,
        executable: &Path,
        keep_models: bool,
        copy: impl FnOnce(&Path) -> io::Result<()>,
    ) -> io::Result<Self> {
        if executable.is_absolute()
            || executable
                .components()
                .any(|part| !matches!(part, std::path::Component::Normal(_)))
        {
            return Err(io::Error::other("Invalid payload executable path"));
        }
        let name = destination
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| !name.is_empty() && !name.contains(['\n', '\r']))
            .ok_or_else(|| {
                io::Error::other("Choose an application folder, not a filesystem root")
            })?;
        let parent = destination
            .parent()
            .filter(|path| !path.as_os_str().is_empty())
            .ok_or_else(|| io::Error::other("Install directory needs an explicit parent"))?;
        fs::create_dir_all(parent)?;
        let parent = fs::canonicalize(parent)?;
        let destination = parent.join(name);
        plain_directory(&destination)?;
        let directory = parent.join(format!(".{name}.loklm-update"));
        let identity = format!(
            "LokLM payload transaction v1\n{}\nmodels={}\n",
            destination
                .to_str()
                .ok_or_else(|| io::Error::other("Unsupported install path encoding"))?,
            keep_models
        );
        initialize_journal(&directory, identity.as_bytes())?;
        let lock_path = directory.join("lock");
        if fs::symlink_metadata(&lock_path).is_ok_and(|meta| meta.file_type().is_symlink()) {
            return Err(io::Error::other("Unexpected journal lock link"));
        }
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(lock_path)?;
        lock.try_lock().map_err(|_| {
            io::Error::other("Another installer is updating this application folder")
        })?;
        let mut update = Self {
            destination,
            directory,
            keep_models,
            executable: executable.to_path_buf(),
            had_previous: false,
            _lock: lock,
            settled: true,
        };
        update.recover()?;
        update.had_previous = update.validate_destination()?;
        update.write_state("prepared")?;
        update.settled = false;
        fs::create_dir(update.stage())?;
        copy(&update.stage())?;
        if !update.stage().join(executable).is_file() {
            return Err(io::Error::other(
                "The staged application executable is missing",
            ));
        }
        if keep_models {
            if fs::symlink_metadata(update.stage().join("models")).is_ok() {
                return Err(io::Error::other(
                    "The application payload must not contain a models folder",
                ));
            }
            let marker = update.destination.join("loklm-tier.json");
            if marker.is_file() {
                fs::copy(marker, update.stage().join("loklm-tier.json"))?;
            }
        }
        Ok(update)
    }

    fn validate_destination(&self) -> io::Result<bool> {
        if !plain_directory(&self.destination)? {
            return Ok(false);
        }
        if self.keep_models {
            plain_directory(&self.destination.join("models"))?;
        }
        if self.destination.join(&self.executable).is_file() {
            return Ok(true);
        }
        if fs::read_dir(&self.destination)?
            .next()
            .transpose()?
            .is_some()
        {
            return Err(io::Error::other(
                "The chosen folder is not an existing LokLM installation",
            ));
        }
        Ok(false)
    }
    fn stage(&self) -> PathBuf {
        self.directory.join("pending")
    }
    fn previous(&self) -> PathBuf {
        self.directory.join("previous")
    }

    fn write_state(&self, state: &str) -> io::Result<()> {
        write_durable(&self.directory.join("state"), state.as_bytes())
    }

    fn remove_owned(&self, name: &str) -> io::Result<()> {
        if !["pending", "previous", "failed"].contains(&name) {
            return Err(io::Error::other("Invalid update cleanup target"));
        }
        let target = self.directory.join(name);
        if plain_directory(&target)? {
            fs::remove_dir_all(target)?;
        }
        Ok(())
    }

    /// Call only after the old app has exited and the new payload is complete.
    pub fn activate(&mut self) -> io::Result<()> {
        if self.validate_destination()? != self.had_previous {
            return Err(io::Error::other(
                "The install directory changed while preparing the update",
            ));
        }
        self.write_state("switching")?;
        if self.had_previous {
            fs::rename(&self.destination, self.previous())?;
            if self.keep_models && plain_directory(&self.previous().join("models"))? {
                fs::rename(self.previous().join("models"), self.stage().join("models"))?;
            }
        } else if plain_directory(&self.destination)? {
            // Remove only an empty fresh-install placeholder. A concurrent
            // new entry makes remove_dir fail instead of losing its contents.
            fs::remove_dir(&self.destination)?;
        }
        fs::rename(self.stage(), &self.destination)?;
        self.write_state("active")?;
        Ok(())
    }

    /// Mark the payload accepted only after model/setup operations succeed.
    pub fn commit(mut self) -> io::Result<()> {
        self.write_state("committed")?;
        self.settled = true;
        // A locked old file must not invalidate an otherwise complete install.
        // The committed journal retries cleanup next time without rolling back.
        if let Err(error) = self.remove_owned("previous") {
            eprintln!("Previous LokLM payload retained for later cleanup: {error}");
        }
        Ok(())
    }

    fn recover(&mut self) -> io::Result<()> {
        let state_path = self.directory.join("state");
        if fs::symlink_metadata(&state_path).is_ok_and(|meta| meta.file_type().is_symlink()) {
            return Err(io::Error::other("Unexpected journal state link"));
        }
        let state = match fs::read_to_string(state_path) {
            Ok(state) => state,
            Err(error) if error.kind() == io::ErrorKind::NotFound => String::new(),
            Err(error) => return Err(error),
        };
        if !["", "prepared", "switching", "active", "committed", "idle"].contains(&state.as_str()) {
            return Err(io::Error::other(
                "Unrecognized update journal; previous files were preserved",
            ));
        }
        if state != "committed" && plain_directory(&self.previous())? {
            if self.keep_models {
                let carriers = [
                    self.destination.clone(),
                    self.stage(),
                    self.directory.join("failed"),
                ];
                let models: Vec<PathBuf> = carriers
                    .iter()
                    .map(|base| base.join("models"))
                    .map(|path| path_present(&path).map(|present| present.then_some(path)))
                    .collect::<io::Result<Vec<_>>>()?
                    .into_iter()
                    .flatten()
                    .collect();
                let previous_has_models = path_present(&self.previous().join("models"))?;
                if models.len() > 1 || (previous_has_models && !models.is_empty()) {
                    return Err(io::Error::other(
                        "Multiple model folders need recovery; no files were removed",
                    ));
                }
                // If the backup already has a models entry, restore it whole even
                // when that entry is invalid. Do not strand the old executable by
                // repeating the validation failure that interrupted an older swap.
                if !previous_has_models {
                    if let Some(models) = models.first() {
                        plain_directory(models)?;
                        fs::rename(models, self.previous().join("models"))?;
                    }
                }
            }
            if plain_directory(&self.destination)? {
                // Keep this failed payload too until the previous app is back.
                self.remove_owned("failed")?;
                fs::rename(&self.destination, self.directory.join("failed"))?;
            }
            fs::rename(self.previous(), &self.destination)?;
        }
        self.remove_owned("pending")?;
        self.remove_owned("failed")?;
        if state == "committed" {
            self.remove_owned("previous")?;
        }
        self.write_state("idle")?;
        Ok(())
    }
}

impl Drop for PayloadUpdate {
    fn drop(&mut self) {
        if !self.settled {
            if let Err(error) = self.recover() {
                eprintln!(
                    "LokLM update recovery pending in {}: {error}",
                    self.directory.display()
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!(
                "loklm-payload-test-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&root).unwrap();
            Self(root)
        }
        fn target(&self) -> PathBuf {
            self.0.join("LokLM")
        }
        fn old(&self) {
            fs::create_dir(self.target()).unwrap();
            fs::write(self.target().join("app"), b"old app").unwrap();
            fs::create_dir(self.target().join("models")).unwrap();
            fs::write(self.target().join("models/model.gguf"), b"original model").unwrap();
            fs::write(self.target().join("loklm-tier.json"), b"old marker").unwrap();
        }
        fn prepare(&self) -> io::Result<PayloadUpdate> {
            PayloadUpdate::prepare(&self.target(), Path::new("app"), true, |stage| {
                fs::write(stage.join("app"), b"new app")
            })
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn copy_failure_leaves_old_payload_and_models_untouched() {
        let fixture = Fixture::new();
        fixture.old();
        let failed = PayloadUpdate::prepare(&fixture.target(), Path::new("app"), true, |stage| {
            fs::write(stage.join("app"), b"partial")?;
            Err(io::Error::other("disk full"))
        });
        assert!(failed.is_err());
        assert_eq!(fs::read(fixture.target().join("app")).unwrap(), b"old app");
        assert_eq!(
            fs::read(fixture.target().join("models/model.gguf")).unwrap(),
            b"original model"
        );
        assert!(fixture.prepare().is_ok());
    }
    #[test]
    fn setup_failure_restores_app_and_preserves_new_model_downloads() {
        let fixture = Fixture::new();
        fixture.old();
        let mut update = fixture.prepare().unwrap();
        update.activate().unwrap();
        fs::write(fixture.target().join("models/another.gguf"), b"new model").unwrap();
        fs::write(fixture.target().join("loklm-tier.json"), b"new marker").unwrap();
        drop(update);
        assert_eq!(fs::read(fixture.target().join("app")).unwrap(), b"old app");
        assert_eq!(
            fs::read(fixture.target().join("models/another.gguf")).unwrap(),
            b"new model"
        );
        assert_eq!(
            fs::read(fixture.target().join("loklm-tier.json")).unwrap(),
            b"old marker"
        );
    }
    #[test]
    fn successful_update_commits_complete_payload_and_models() {
        let fixture = Fixture::new();
        fixture.old();
        let mut update = fixture.prepare().unwrap();
        update.activate().unwrap();
        update.commit().unwrap();
        assert_eq!(fs::read(fixture.target().join("app")).unwrap(), b"new app");
        assert_eq!(
            fs::read(fixture.target().join("models/model.gguf")).unwrap(),
            b"original model"
        );
        let next = fixture.prepare().unwrap();
        assert_eq!(fs::read(fixture.target().join("app")).unwrap(), b"new app");
        drop(next);
    }
    #[test]
    fn interrupted_swap_recovers_before_next_attempt() {
        let fixture = Fixture::new();
        fixture.old();
        let mut update = fixture.prepare().unwrap();
        update.write_state("switching").unwrap();
        fs::rename(&update.destination, update.previous()).unwrap();
        fs::rename(
            update.previous().join("models"),
            update.stage().join("models"),
        )
        .unwrap();
        update.settled = true;
        drop(update); // simulate process exit, without rollback
        let retry = fixture.prepare().unwrap();
        assert_eq!(fs::read(fixture.target().join("app")).unwrap(), b"old app");
        assert_eq!(
            fs::read(fixture.target().join("models/model.gguf")).unwrap(),
            b"original model"
        );
        drop(retry);
    }
    #[test]
    fn interrupted_active_update_rolls_back_on_retry() {
        let fixture = Fixture::new();
        fixture.old();
        let mut update = fixture.prepare().unwrap();
        update.activate().unwrap();
        update.settled = true;
        drop(update);
        let retry = fixture.prepare().unwrap();
        assert_eq!(fs::read(fixture.target().join("app")).unwrap(), b"old app");
        drop(retry);
    }
    #[test]
    fn fresh_install_failure_keeps_complete_payload_for_retry() {
        let fixture = Fixture::new();
        let mut update = fixture.prepare().unwrap();
        update.activate().unwrap();
        drop(update);
        assert_eq!(fs::read(fixture.target().join("app")).unwrap(), b"new app");
        assert!(fixture.prepare().is_ok());
    }
    #[test]
    fn concurrent_installer_cannot_recover_an_active_transaction() {
        let fixture = Fixture::new();
        fixture.old();
        let mut update = fixture.prepare().unwrap();
        update.activate().unwrap();
        assert!(fixture.prepare().is_err());
        assert_eq!(fs::read(fixture.target().join("app")).unwrap(), b"new app");
        drop(update);
    }
    #[test]
    fn non_application_destination_is_not_modified() {
        let fixture = Fixture::new();
        fs::create_dir(fixture.target()).unwrap();
        fs::write(fixture.target().join("personal.txt"), b"keep").unwrap();
        assert!(fixture.prepare().is_err());
        assert_eq!(
            fs::read(fixture.target().join("personal.txt")).unwrap(),
            b"keep"
        );
    }
    #[test]
    fn unrelated_journal_directory_is_not_adopted_or_removed() {
        let fixture = Fixture::new();
        let journal = fixture.0.join(".LokLM.loklm-update");
        fs::create_dir(&journal).unwrap();
        fs::write(journal.join("personal.txt"), b"keep").unwrap();
        assert!(fixture.prepare().is_err());
        assert!(journal.join("personal.txt").exists());
    }
    #[test]
    fn missing_executable_or_payload_models_never_replace_previous_app() {
        let fixture = Fixture::new();
        fixture.old();
        assert!(
            PayloadUpdate::prepare(&fixture.target(), Path::new("app"), true, |_| Ok(())).is_err()
        );
        assert!(
            PayloadUpdate::prepare(&fixture.target(), Path::new("app"), true, |stage| {
                fs::write(stage.join("app"), b"new")?;
                fs::create_dir(stage.join("models"))
            })
            .is_err()
        );
        assert_eq!(fs::read(fixture.target().join("app")).unwrap(), b"old app");
    }

    #[test]
    fn invalid_existing_models_entry_never_displaces_previous_app() {
        let fixture = Fixture::new();
        fs::create_dir(fixture.target()).unwrap();
        fs::write(fixture.target().join("app"), b"old app").unwrap();
        fs::write(fixture.target().join("models"), b"unexpected file").unwrap();
        let result = fixture.prepare().and_then(|mut update| update.activate());
        assert!(result.is_err());
        assert_eq!(fs::read(fixture.target().join("app")).unwrap(), b"old app");
        assert_eq!(
            fs::read(fixture.target().join("models")).unwrap(),
            b"unexpected file"
        );
    }

    #[test]
    fn existing_empty_folder_is_a_fresh_install_and_can_retry_model_failure() {
        let fixture = Fixture::new();
        fs::create_dir(fixture.target()).unwrap();
        let mut update = fixture.prepare().unwrap();
        update.activate().unwrap();
        fs::create_dir(fixture.target().join("models")).unwrap();
        fs::write(fixture.target().join("models/new.gguf"), b"complete model").unwrap();
        drop(update);
        assert_eq!(fs::read(fixture.target().join("app")).unwrap(), b"new app");
        assert_eq!(
            fs::read(fixture.target().join("models/new.gguf")).unwrap(),
            b"complete model"
        );
        assert!(fixture.prepare().is_ok());
    }

    #[test]
    fn model_shape_is_rechecked_before_displacing_the_app() {
        let fixture = Fixture::new();
        fs::create_dir(fixture.target()).unwrap();
        fs::write(fixture.target().join("app"), b"old app").unwrap();
        let mut update = fixture.prepare().unwrap();
        fs::write(fixture.target().join("models"), b"new unrelated file").unwrap();
        assert!(update.activate().is_err());
        drop(update);
        assert_eq!(fs::read(fixture.target().join("app")).unwrap(), b"old app");
        assert_eq!(
            fs::read(fixture.target().join("models")).unwrap(),
            b"new unrelated file"
        );
    }

    #[test]
    fn a_fresh_target_that_becomes_nonempty_is_not_removed() {
        let fixture = Fixture::new();
        fs::create_dir(fixture.target()).unwrap();
        let mut update = fixture.prepare().unwrap();
        fs::write(fixture.target().join("personal.txt"), b"keep").unwrap();
        assert!(update.activate().is_err());
        drop(update);
        assert_eq!(
            fs::read(fixture.target().join("personal.txt")).unwrap(),
            b"keep"
        );
    }

    #[test]
    fn a_fresh_target_that_becomes_an_application_requires_a_new_attempt() {
        let fixture = Fixture::new();
        let mut update = fixture.prepare().unwrap();
        fs::create_dir(fixture.target()).unwrap();
        fs::write(fixture.target().join("app"), b"concurrent app").unwrap();
        assert!(update.activate().is_err());
        drop(update);
        assert_eq!(
            fs::read(fixture.target().join("app")).unwrap(),
            b"concurrent app"
        );
    }

    #[test]
    fn recovery_restores_whole_backup_with_invalid_model_entry() {
        let fixture = Fixture::new();
        fs::create_dir(fixture.target()).unwrap();
        fs::write(fixture.target().join("app"), b"old app").unwrap();
        let mut update = fixture.prepare().unwrap();
        update.write_state("switching").unwrap();
        fs::rename(&update.destination, update.previous()).unwrap();
        // Reproduce an interrupted older installer, which moved before validation.
        fs::write(update.previous().join("models"), b"original invalid entry").unwrap();
        update.settled = true;
        drop(update);
        // Recovery succeeds, then admission still correctly rejects that entry.
        assert!(fixture.prepare().is_err());
        assert_eq!(fs::read(fixture.target().join("app")).unwrap(), b"old app");
        assert_eq!(
            fs::read(fixture.target().join("models")).unwrap(),
            b"original invalid entry"
        );
    }

    #[test]
    fn ambiguous_model_carriers_are_preserved_for_recovery() {
        let fixture = Fixture::new();
        fixture.old();
        let mut update = fixture.prepare().unwrap();
        update.activate().unwrap();
        fs::create_dir(update.previous().join("models")).unwrap();
        fs::write(update.previous().join("models/other.gguf"), b"other model").unwrap();
        assert!(update.recover().is_err());
        assert_eq!(
            fs::read(fixture.target().join("models/model.gguf")).unwrap(),
            b"original model"
        );
        assert_eq!(
            fs::read(update.previous().join("models/other.gguf")).unwrap(),
            b"other model"
        );
        update.settled = true;
    }

    #[test]
    fn interrupted_unpublished_initialization_does_not_block_retry() {
        let fixture = Fixture::new();
        let journal = fixture.0.join(".LokLM.loklm-update");
        let without_owner = initialization_directory(&journal).unwrap();
        let partial_owner = initialization_directory(&journal).unwrap();
        fs::write(partial_owner.join("owner"), b"partial identity").unwrap();
        let update = fixture.prepare().unwrap();
        assert!(without_owner.is_dir());
        assert_eq!(
            fs::read(partial_owner.join("owner")).unwrap(),
            b"partial identity"
        );
        assert!(journal.join("owner").is_file());
        drop(update);
    }

    #[test]
    fn empty_unowned_journal_is_not_adopted() {
        let fixture = Fixture::new();
        let journal = fixture.0.join(".LokLM.loklm-update");
        fs::create_dir(&journal).unwrap();
        assert!(fixture.prepare().is_err());
        assert_eq!(fs::read_dir(&journal).unwrap().count(), 0);
        assert!(!fixture.target().exists());
    }

    #[test]
    fn publication_cannot_replace_an_existing_empty_directory() {
        let fixture = Fixture::new();
        let source = fixture.0.join("initializer");
        let target = fixture.0.join("unrelated");
        fs::create_dir(&source).unwrap();
        fs::write(source.join("owner"), b"ready").unwrap();
        fs::create_dir(&target).unwrap();
        assert!(publish_directory(&source, &target).is_err());
        assert_eq!(fs::read_dir(&target).unwrap().count(), 0);
        assert_eq!(fs::read(source.join("owner")).unwrap(), b"ready");
    }

    #[test]
    fn concurrent_first_initializers_publish_one_complete_identity() {
        let fixture = Fixture::new();
        let journal = fixture.0.join(".LokLM.loklm-update");
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(8));
        let handles: Vec<_> = (0..8)
            .map(|_| {
                let journal = journal.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    initialize_journal(&journal, b"complete test identity")
                })
            })
            .collect();
        for handle in handles {
            handle.join().unwrap().unwrap();
        }
        assert_eq!(
            fs::read(journal.join("owner")).unwrap(),
            b"complete test identity"
        );
        assert_eq!(fs::read_dir(&fixture.0).unwrap().count(), 1);
    }
}
