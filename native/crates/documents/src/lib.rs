//! Bounded PDF text-layer import. The desktop calls `parse_isolated`, never the
//! parser in its vault process. No paths, keys, network or document logs in IPC.
use loklm_core::{Error, Result, session::Ticket};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use std::io::{Read, Write};
#[cfg(windows)]
use std::{
    process::{Command, Stdio},
    time::{Duration, Instant},
};
use zeroize::Zeroizing;

pub const INPUT_LIMIT: usize = 16 * 1024 * 1024;
pub const OUTPUT_LIMIT: usize = 16 * 1024 * 1024;
pub const WORKER_ARGUMENT: &str = "--loklm-pdf-worker-v1";
pub const DOCX_WORKER_ARGUMENT: &str = "--loklm-docx-worker-v1";
mod docx;
pub use docx::ParsedDocx;
#[derive(Debug, Serialize, Deserialize)]
pub struct ParsedPdf {
    pub pages: Vec<(u32, String)>,
}

/// Worker output has fixed diagnostics, never third-party parser messages which
/// might contain document text. JSON serialization is private piped IPC only.
pub fn worker_main() -> i32 {
    worker(extract)
}
pub fn docx_worker_main() -> i32 {
    worker(docx::extract)
}
fn worker<T: Serialize>(parse: fn(&[u8]) -> Result<T>) -> i32 {
    std::panic::set_hook(Box::new(|_| {}));
    let result = std::panic::catch_unwind(|| -> Result<T> {
        let mut bytes = Zeroizing::new(Vec::new());
        std::io::stdin()
            .take((INPUT_LIMIT + 1) as u64)
            .read_to_end(&mut bytes)?;
        parse(&bytes)
    });
    let response: std::result::Result<T, String> = match result {
        Ok(Ok(pdf)) => Ok(pdf),
        Ok(Err(Error::Unsupported(message))) => Err(message),
        _ => Err("Document parsing failed; no content was imported".into()),
    };
    if serde_json::to_writer(std::io::stdout().lock(), &response).is_ok() {
        0
    } else {
        1
    }
}

struct BoundedText {
    text: String,
    limit: usize,
}
impl Write for BoundedText {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if self.text.len().saturating_add(bytes.len()) > self.limit {
            return Err(std::io::Error::other("PDF output limit"));
        }
        let s = std::str::from_utf8(bytes).map_err(std::io::Error::other)?;
        self.text.push_str(s);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
fn extract(bytes: &[u8]) -> Result<ParsedPdf> {
    if bytes.len() > INPUT_LIMIT || !bytes.starts_with(b"%PDF-") {
        return Err(Error::Invalid("PDF input limit or signature".into()));
    }
    let doc =
        pdf_extract::Document::load_mem(bytes).map_err(|_| Error::Invalid("PDF syntax".into()))?;
    if doc.is_encrypted() {
        return Err(Error::Unsupported(
            "Password-protected PDF import is not available".into(),
        ));
    }
    // Refuse rather than silently losing diagrams/scanned page content. This is
    // intentionally conservative, including unused image objects.
    for object in doc.objects.values() {
        if let Ok(stream) = object.as_stream()
            && (matches!(
                stream.dict.get(b"Subtype").and_then(|v| v.as_name()).ok(),
                Some(b"Image" | b"Form")
            ) || stream.dict.get(b"Type").and_then(|v| v.as_name()).ok()
                == Some(b"EmbeddedFile".as_slice()))
        {
            return Err(Error::Unsupported("This PDF contains images, form objects or attachments; the full PDF/OCR importer is not available yet".into()));
        }
        if let Ok(dict) = object.as_dict()
            && [b"AcroForm".as_slice(), b"Annots", b"Outlines"]
                .iter()
                .any(|key| dict.has(key))
        {
            return Err(Error::Unsupported("PDF forms, annotations and bookmark hierarchy require the pending full PDF importer".into()));
        }
    }
    let pages = doc.get_pages();
    if pages.is_empty() || pages.len() > 1000 {
        return Err(Error::Invalid("PDF page limit".into()));
    }
    let mut result = Vec::new();
    let mut remaining = OUTPUT_LIMIT;
    for (number, id) in pages {
        // Reject inline image content too; content decode failures fail the
        // entire transaction. External actions/links are never followed.
        let content = doc
            .get_page_content(id)
            .map_err(|_| Error::Invalid("PDF page content".into()))?;
        let operations = pdf_extract::content::Content::decode(&content)
            .map_err(|_| Error::Invalid("PDF page operators".into()))?;
        if operations
            .operations
            .iter()
            .any(|op| ["BI", "ID", "EI"].contains(&op.operator.as_str()))
        {
            return Err(Error::Unsupported(
                "Inline PDF images require the pending OCR importer".into(),
            ));
        }
        let mut text = BoundedText {
            text: String::new(),
            limit: remaining,
        };
        let mut output = pdf_extract::PlainTextOutput::new(&mut text as &mut dyn Write);
        pdf_extract::output_doc_page(&doc, &mut output, number)
            .map_err(|_| Error::Invalid("PDF page extraction".into()))?;
        if text.text.trim().is_empty() {
            return Err(Error::Unsupported(
                "A PDF page has no extractable text; OCR or explicit blank-page review is required"
                    .into(),
            ));
        }
        remaining -= text.text.len();
        result.push((number, text.text));
    }
    Ok(ParsedPdf { pages: result })
}

/// Separate worker with private pipes, a 30s wall-clock limit and cancellation.
/// Windows Job Object bounds committed memory to 512 MiB and one process; its
/// close also kills the worker. Unsupported platforms refuse this preview path.
pub fn parse_isolated(bytes: &[u8], ticket: &Ticket) -> Result<ParsedPdf> {
    parse_worker(bytes, ticket, WORKER_ARGUMENT)
}
pub fn parse_docx_isolated(bytes: &[u8], ticket: &Ticket) -> Result<ParsedDocx> {
    parse_worker(bytes, ticket, DOCX_WORKER_ARGUMENT)
}
fn parse_worker<T: DeserializeOwned>(bytes: &[u8], ticket: &Ticket, argument: &str) -> Result<T> {
    ticket.check()?;
    if bytes.len() > INPUT_LIMIT {
        return Err(Error::Invalid("Document exceeds 16 MiB".into()));
    }
    #[cfg(not(windows))]
    {
        let _ = (bytes, argument);
        Err(Error::Unsupported(
            "Isolated document worker is currently validated on Windows only".into(),
        ))
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut command = Command::new(std::env::current_exe()?);
        command
            .arg(argument)
            .env_clear()
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW);
        if let Some(root) = std::env::var_os("SystemRoot") {
            command.env("SystemRoot", root);
        }
        let mut child = command.spawn()?;
        let job = match job::Job::attach(&child) {
            Ok(job) => job,
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error);
            }
        };
        let mut input = child
            .stdin
            .take()
            .ok_or_else(|| Error::Invalid("Parser input pipe".into()))?;
        let output = child
            .stdout
            .take()
            .ok_or_else(|| Error::Invalid("Parser output pipe".into()))?;
        let bytes = Zeroizing::new(bytes.to_vec());
        let writer = std::thread::spawn(move || input.write_all(&bytes));
        let reader = std::thread::spawn(move || {
            let mut response = Zeroizing::new(Vec::new());
            output
                .take((OUTPUT_LIMIT * 6 + 65536) as u64)
                .read_to_end(&mut response)?;
            Ok::<_, std::io::Error>(response)
        });
        let started = Instant::now();
        let finished = loop {
            if ticket.check().is_err() {
                break Err(Error::Revoked);
            }
            if started.elapsed() > Duration::from_secs(30) {
                break Err(Error::Invalid(
                    "Document parsing timed out; nothing imported".into(),
                ));
            }
            match child.try_wait() {
                Ok(Some(status)) => {
                    break if status.success() {
                        Ok(())
                    } else {
                        Err(Error::Invalid(
                            "Document worker failed or exceeded its memory limit".into(),
                        ))
                    };
                }
                Ok(None) => std::thread::sleep(Duration::from_millis(20)),
                Err(error) => break Err(error.into()),
            }
        };
        if finished.is_err() {
            let _ = child.kill();
        }
        let _ = child.wait();
        drop(job);
        let written = writer.join();
        let received = reader.join();
        finished?;
        written.map_err(|_| Error::Invalid("Parser input stopped".into()))??;
        let response = received.map_err(|_| Error::Invalid("Parser output stopped".into()))??;
        let parsed: std::result::Result<T, String> = serde_json::from_slice(&response)?;
        ticket.check()?;
        parsed.map_err(Error::Unsupported)
    }
}

#[cfg(windows)]
mod job {
    use super::*;
    use std::{
        mem::{size_of, zeroed},
        os::windows::io::AsRawHandle,
    };
    use windows_sys::Win32::{
        Foundation::{CloseHandle, HANDLE},
        System::JobObjects::*,
    };
    pub struct Job(HANDLE);
    impl Job {
        pub fn attach(child: &std::process::Child) -> Result<Self> {
            unsafe {
                let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if handle.is_null() {
                    return Err(std::io::Error::last_os_error().into());
                }
                let job = Self(handle);
                let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = zeroed();
                limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
                    | JOB_OBJECT_LIMIT_PROCESS_MEMORY
                    | JOB_OBJECT_LIMIT_ACTIVE_PROCESS;
                limits.BasicLimitInformation.ActiveProcessLimit = 1;
                limits.ProcessMemoryLimit = 512 * 1024 * 1024;
                if SetInformationJobObject(
                    handle,
                    JobObjectExtendedLimitInformation,
                    (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                    size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                ) == 0
                    || AssignProcessToJobObject(handle, child.as_raw_handle()) == 0
                {
                    return Err(std::io::Error::last_os_error().into());
                }
                Ok(job)
            }
        }
    }
    impl Drop for Job {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_page_identity_and_unicode() {
        let parsed = extract(include_bytes!("../tests/fixtures/synthetic.pdf")).unwrap();
        assert_eq!(parsed.pages.len(), 2);
        assert_eq!(parsed.pages[0].0, 1);
        assert!(parsed.pages[0].1.contains("Grüße aus Köln"));
        assert_eq!(parsed.pages[1].0, 2);
        assert!(parsed.pages[1].1.contains("<script>"));
        assert!(parsed.pages[1].1.contains("ALPHA-47"));
    }
    #[test]
    fn later_page_error_and_ocr_requirements_never_return_partial_pages() {
        for bytes in [
            include_bytes!("../tests/fixtures/broken-page.pdf").as_slice(),
            include_bytes!("../tests/fixtures/blank-page.pdf"),
            include_bytes!("../tests/fixtures/image.pdf"),
        ] {
            assert!(extract(bytes).is_err());
        }
        assert!(extract(b"not a PDF").is_err());
        assert!(extract(&vec![0; INPUT_LIMIT + 1]).is_err());
    }
    #[test]
    fn output_expansion_is_bounded_without_partial_scalar_writes() {
        let mut sink = BoundedText {
            text: String::new(),
            limit: 5,
        };
        sink.write_all("äö".as_bytes()).unwrap();
        assert!(sink.write_all("ü".as_bytes()).is_err());
        assert_eq!(sink.text, "äö");
    }
}
