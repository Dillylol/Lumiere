//! Verified downloads and safe archive extraction.

use crate::tasks::{TaskHandle, CANCELLED};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::thread;
use std::time::{Duration, Instant};

const STALL_TIMEOUT: Duration = Duration::from_secs(60);
const ATTEMPTS: u32 = 3;

pub fn sha256_file(path: &Path) -> io::Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    io::copy(&mut file, &mut hasher)?;
    Ok(hex(&hasher.finalize()))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Returns a cached copy of `url` whose SHA-256 is `expected`, downloading it if needed. Retries
/// network failures, never a checksum mismatch.
pub fn fetch(
    url: &str,
    expected: &str,
    cache: &Path,
    task: &TaskHandle,
    progress: &dyn Fn(u64, Option<u64>),
) -> Result<PathBuf, String> {
    if expected.len() != 64
        || !expected
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err(format!("Invalid pinned checksum for {url}."));
    }
    fs::create_dir_all(cache)
        .map_err(|error| format!("Could not create the download cache: {error}"))?;
    let cached = cache.join(expected);
    if cached.is_file() {
        if sha256_file(&cached).ok().as_deref() == Some(expected) {
            return Ok(cached);
        }
        let _ = fs::remove_file(&cached);
    }

    let mut attempt = 1;
    loop {
        task.check()?;
        match download_once(url, expected, cache, task, progress) {
            Ok(partial) => {
                fs::rename(&partial, &cached)
                    .map_err(|error| format!("Could not save the download: {error}"))?;
                return Ok(cached);
            }
            Err(Failure::Retry(_)) if attempt < ATTEMPTS => {
                thread::sleep(Duration::from_secs(u64::from(attempt)));
                attempt += 1;
            }
            Err(Failure::Retry(message) | Failure::Fatal(message)) => return Err(message),
        }
    }
}

enum Failure {
    Retry(String),
    Fatal(String),
}

enum Chunk {
    Length(Option<u64>),
    Data(Vec<u8>),
    End,
    Error(String, bool),
}

fn download_once(
    url: &str,
    expected: &str,
    cache: &Path,
    task: &TaskHandle,
    progress: &dyn Fn(u64, Option<u64>),
) -> Result<PathBuf, Failure> {
    // Reads happen on a helper thread so a stalled connection cannot block cancellation.
    let (sender, receiver) = mpsc::sync_channel::<Chunk>(16);
    let owned_url = url.to_owned();
    thread::spawn(move || {
        let response = match agent().get(&owned_url).call() {
            Ok(response) => response,
            Err(error) => {
                let retry =
                    !matches!(error, ureq::Error::StatusCode(code) if (400..500).contains(&code));
                let _ = sender.send(Chunk::Error(describe(&error), retry));
                return;
            }
        };
        let length = response
            .headers()
            .get("content-length")
            .and_then(|value| value.to_str().ok()?.parse().ok());
        if sender.send(Chunk::Length(length)).is_err() {
            return;
        }
        let mut reader = response.into_body().into_reader();
        let mut buffer = vec![0; 256 * 1024];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => {
                    let _ = sender.send(Chunk::End);
                    return;
                }
                Ok(count) => {
                    if sender.send(Chunk::Data(buffer[..count].to_vec())).is_err() {
                        return;
                    }
                }
                Err(error) => {
                    let _ = sender.send(Chunk::Error(error.to_string(), true));
                    return;
                }
            }
        }
    });

    static PARTIAL: AtomicU64 = AtomicU64::new(0);
    let partial = cache.join(format!(
        "{expected}.{}-{}.part",
        std::process::id(),
        PARTIAL.fetch_add(1, Ordering::Relaxed)
    ));
    let result = receive(url, expected, &partial, &receiver, task, progress);
    if result.is_err() {
        let _ = fs::remove_file(&partial);
    }
    result.map(|_| partial)
}

fn receive(
    url: &str,
    expected: &str,
    partial: &Path,
    receiver: &mpsc::Receiver<Chunk>,
    task: &TaskHandle,
    progress: &dyn Fn(u64, Option<u64>),
) -> Result<(), Failure> {
    let mut file = File::create(partial)
        .map_err(|error| Failure::Fatal(format!("Could not write the download: {error}")))?;
    let mut hasher = Sha256::new();
    let mut total = None;
    let mut received = 0u64;
    let mut last_data = Instant::now();
    let mut last_report = Instant::now();
    loop {
        if task.is_cancelled() {
            return Err(Failure::Fatal(CANCELLED.into()));
        }
        match receiver.recv_timeout(Duration::from_millis(250)) {
            Ok(Chunk::Length(length)) => {
                total = length;
                progress(0, total);
            }
            Ok(Chunk::Data(data)) => {
                file.write_all(&data).map_err(|error| {
                    Failure::Fatal(format!("Could not write the download: {error}"))
                })?;
                hasher.update(&data);
                received += data.len() as u64;
                last_data = Instant::now();
                if last_report.elapsed() >= Duration::from_millis(100) {
                    progress(received, total);
                    last_report = Instant::now();
                }
            }
            Ok(Chunk::End) => break,
            Ok(Chunk::Error(message, retry)) => {
                let message = format!("Could not download {url}: {message}");
                return Err(if retry {
                    Failure::Retry(message)
                } else {
                    Failure::Fatal(message)
                });
            }
            Err(RecvTimeoutError::Timeout) if last_data.elapsed() < STALL_TIMEOUT => {}
            Err(RecvTimeoutError::Timeout) => {
                return Err(Failure::Retry(format!(
                    "The download of {url} stopped responding."
                )))
            }
            Err(RecvTimeoutError::Disconnected) => {
                return Err(Failure::Retry(format!(
                    "The download of {url} ended unexpectedly."
                )))
            }
        }
    }
    progress(received, total);
    file.sync_all()
        .map_err(|error| Failure::Fatal(format!("Could not write the download: {error}")))?;
    if let Some(total) = total.filter(|total| *total != received) {
        return Err(Failure::Retry(format!(
            "The download of {url} was incomplete ({received} of {total} bytes)."
        )));
    }
    let actual = hex(&hasher.finalize());
    if actual != expected {
        return Err(Failure::Fatal(format!(
            "The download of {url} did not match its pinned checksum (expected {expected}, received {actual}). Nothing was installed."
        )));
    }
    Ok(())
}

fn agent() -> ureq::Agent {
    use ureq::tls::{RootCerts, TlsConfig};
    // The operating system's certificate store also covers school and company networks that inspect TLS.
    ureq::Agent::config_builder()
        .timeout_connect(Some(Duration::from_secs(30)))
        .timeout_recv_response(Some(Duration::from_secs(60)))
        .tls_config(
            TlsConfig::builder()
                .root_certs(RootCerts::PlatformVerifier)
                .build(),
        )
        .build()
        .into()
}

fn describe(error: &ureq::Error) -> String {
    match error {
        ureq::Error::StatusCode(code) => format!("the server returned HTTP {code}"),
        other => other.to_string(),
    }
}

/// Visits each file in a zip archive. Directory entries are skipped; unsafe paths and links are errors.
pub fn zip_entries(
    archive: &Path,
    task: &TaskHandle,
    mut visit: impl FnMut(&str, &mut dyn Read, bool) -> Result<(), String>,
) -> Result<(), String> {
    let file = File::open(archive)
        .map_err(|error| format!("Could not open {}: {error}", archive.display()))?;
    let mut zip = zip::ZipArchive::new(file)
        .map_err(|error| format!("{} is not a valid zip archive: {error}", archive.display()))?;
    for index in 0..zip.len() {
        task.check()?;
        let mut entry = zip
            .by_index(index)
            .map_err(|error| format!("Corrupt zip archive: {error}"))?;
        let name = entry.name().to_owned();
        if entry.enclosed_name().is_none() {
            return Err(format!("Unsafe path in archive: {name}"));
        }
        if entry.is_dir() {
            continue;
        }
        if entry.is_symlink() {
            return Err(format!("Unsupported link in archive: {name}"));
        }
        let executable = entry.unix_mode().is_some_and(|mode| mode & 0o111 != 0);
        visit(&name, &mut entry, executable)?;
    }
    Ok(())
}

pub fn extract_zip(archive: &Path, destination: &Path, task: &TaskHandle) -> Result<(), String> {
    zip_entries(archive, task, |name, reader, executable| {
        write_file(&safe_join(destination, name)?, reader, executable)
    })
}

pub fn extract_tar_gz(archive: &Path, destination: &Path, task: &TaskHandle) -> Result<(), String> {
    let file = File::open(archive)
        .map_err(|error| format!("Could not open {}: {error}", archive.display()))?;
    let mut tar = tar::Archive::new(flate2::read::GzDecoder::new(file));
    tar.set_preserve_permissions(true);
    fs::create_dir_all(destination).map_err(|error| error.to_string())?;
    let entries = tar
        .entries()
        .map_err(|error| format!("Corrupt archive: {error}"))?;
    for entry in entries {
        task.check()?;
        let mut entry = entry.map_err(|error| format!("Corrupt archive: {error}"))?;
        let name = entry
            .path()
            .map(|path| path.display().to_string())
            .unwrap_or_default();
        // unpack_in refuses (returns false for) paths that would land outside the destination.
        match entry.unpack_in(destination) {
            Ok(true) => {}
            Ok(false) => return Err(format!("Unsafe path in archive: {name}")),
            Err(error) => return Err(format!("Could not extract {name}: {error}")),
        }
    }
    Ok(())
}

/// Joins an archive-relative path to `root`, rejecting absolute paths and parent components.
pub fn safe_join(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let mut path = root.to_path_buf();
    let mut depth = 0;
    for part in relative.split(['/', '\\']) {
        match part {
            "" | "." => {}
            ".." => {
                return Err(format!(
                    "Refusing to write outside the destination: {relative}"
                ))
            }
            part if part.contains(':') => {
                return Err(format!(
                    "Refusing to write outside the destination: {relative}"
                ))
            }
            part => {
                path.push(part);
                depth += 1;
            }
        }
    }
    if depth == 0 || relative.starts_with(['/', '\\']) {
        return Err(format!(
            "Refusing to write outside the destination: {relative}"
        ));
    }
    Ok(path)
}

pub fn write_file(path: &Path, reader: &mut dyn Read, executable: bool) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create {}: {error}", parent.display()))?;
    }
    let mut file = File::create(path)
        .map_err(|error| format!("Could not write {}: {error}", path.display()))?;
    io::copy(reader, &mut file)
        .map_err(|error| format!("Could not write {}: {error}", path.display()))?;
    set_executable(path, executable)
}

#[cfg(unix)]
pub fn set_executable(path: &Path, executable: bool) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    if executable {
        fs::set_permissions(path, fs::Permissions::from_mode(0o755))
            .map_err(|error| format!("Could not update {}: {error}", path.display()))?;
    }
    Ok(())
}

#[cfg(not(unix))]
pub fn set_executable(_path: &Path, _executable: bool) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tasks::Tasks;
    use std::io::Cursor;

    fn sha256_hex(data: impl AsRef<[u8]>) -> String {
        hex(&Sha256::digest(data))
    }

    fn zip_with(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .unix_permissions(0o755);
        for (name, data) in entries {
            writer.start_file(*name, options).unwrap();
            writer.write_all(data).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    #[test]
    fn hashes_match_known_values() {
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn extracts_zip_files_with_permissions() {
        let temp = tempfile::tempdir().unwrap();
        let archive = temp.path().join("a.zip");
        fs::write(
            &archive,
            zip_with(&[
                ("tool/bin/run", b"#!/bin/sh\n"),
                ("tool/readme.txt", b"hello"),
            ]),
        )
        .unwrap();
        let (_, task) = Tasks::default().start();
        let out = temp.path().join("out");
        extract_zip(&archive, &out, &task).unwrap();
        assert_eq!(
            fs::read_to_string(out.join("tool/readme.txt")).unwrap(),
            "hello"
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_ne!(
                fs::metadata(out.join("tool/bin/run"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o111,
                0
            );
        }
    }

    #[test]
    fn rejects_zip_entries_that_escape_the_destination() {
        let temp = tempfile::tempdir().unwrap();
        let (_, task) = Tasks::default().start();
        for name in ["../evil.txt", "a/../../evil.txt", "/abs.txt"] {
            let archive = temp.path().join("bad.zip");
            let mut writer = zip::ZipWriter::new(File::create(&archive).unwrap());
            writer
                .start_file(name, zip::write::SimpleFileOptions::default())
                .unwrap();
            writer.write_all(b"x").unwrap();
            writer.finish().unwrap();
            let out = temp.path().join("out");
            let error = extract_zip(&archive, &out, &task).unwrap_err();
            assert!(
                error.contains("Unsafe path") || error.contains("outside"),
                "{name}: {error}"
            );
            assert!(!temp.path().join("evil.txt").exists());
        }
    }

    #[test]
    fn safe_join_accepts_relative_paths_only() {
        let root = Path::new("root");
        assert_eq!(
            safe_join(root, "a/b.txt").unwrap(),
            root.join("a").join("b.txt")
        );
        assert_eq!(safe_join(root, "./a\\b").unwrap(), root.join("a").join("b"));
        for bad in [
            "",
            "..",
            "a/../../b",
            "/etc/passwd",
            "\\x",
            "C:/Windows",
            "c:x",
        ] {
            assert!(safe_join(root, bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn extracts_tar_gz_and_rejects_escapes() {
        let temp = tempfile::tempdir().unwrap();
        let (_, task) = Tasks::default().start();
        let build = |entries: &[(&str, &[u8])]| {
            let mut data = Vec::new();
            {
                let encoder = flate2::write::GzEncoder::new(&mut data, flate2::Compression::fast());
                let mut builder = tar::Builder::new(encoder);
                for (name, content) in entries {
                    let mut header = tar::Header::new_gnu();
                    header.set_size(content.len() as u64);
                    header.set_mode(0o755);
                    // Header::set_path refuses "..", so write the raw name to model a hostile archive.
                    let bytes = name.as_bytes();
                    header.as_old_mut().name[..bytes.len()].copy_from_slice(bytes);
                    header.set_cksum();
                    builder.append(&header, *content).unwrap();
                }
                builder.into_inner().unwrap().finish().unwrap();
            }
            data
        };
        let good = temp.path().join("good.tar.gz");
        fs::write(
            &good,
            build(&[
                ("jdk/bin/java", b"java"),
                ("jdk/release", b"JAVA_VERSION=\"21\""),
            ]),
        )
        .unwrap();
        extract_tar_gz(&good, &temp.path().join("out"), &task).unwrap();
        assert_eq!(
            fs::read_to_string(temp.path().join("out/jdk/release")).unwrap(),
            "JAVA_VERSION=\"21\""
        );

        let bad = temp.path().join("bad.tar.gz");
        fs::write(&bad, build(&[("../escaped", b"x")])).unwrap();
        assert!(extract_tar_gz(&bad, &temp.path().join("out2"), &task).is_err());
        assert!(!temp.path().join("escaped").exists());
    }

    #[test]
    fn rejects_malformed_checksums_before_downloading() {
        let temp = tempfile::tempdir().unwrap();
        let (_, task) = Tasks::default().start();
        let error = fetch(
            "https://example.invalid/file",
            "ABC",
            temp.path(),
            &task,
            &|_, _| {},
        )
        .unwrap_err();
        assert!(error.contains("Invalid pinned checksum"));
    }

    #[test]
    fn uses_a_verified_cached_copy_without_network() {
        let temp = tempfile::tempdir().unwrap();
        let (_, task) = Tasks::default().start();
        let expected = sha256_hex(b"cached");
        fs::write(temp.path().join(&expected), b"cached").unwrap();
        let path = fetch(
            "https://example.invalid/file",
            &expected,
            temp.path(),
            &task,
            &|_, _| {},
        )
        .unwrap();
        assert_eq!(fs::read(path).unwrap(), b"cached");
    }

    #[test]
    #[ignore = "downloads from the internet"]
    fn downloads_and_verifies_a_pinned_file() {
        let temp = tempfile::tempdir().unwrap();
        let (_, task) = Tasks::default().start();
        let url = "https://raw.githubusercontent.com/Pedro-Pathing/Quickstart/b4312385b7d0cc5e8dd263ec3927c9ef0cb48f36/LICENSE";
        let expected = "43fdbddb26a1b89f49c94a52181d7c1f99f5d389cffd00371d5618f8f84cfc6d";
        let path = fetch(url, expected, temp.path(), &task, &|_, _| {}).unwrap();
        assert_eq!(sha256_file(&path).unwrap(), expected);
        let wrong = "0".repeat(64);
        let error = fetch(url, &wrong, temp.path(), &task, &|_, _| {}).unwrap_err();
        assert!(error.contains("did not match"), "{error}");
        assert!(!temp.path().join(&wrong).exists());
    }
}
