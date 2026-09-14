//! Cancellable background work: build tool processes, tool installs, and project creation.

use serde::Serialize;
use std::collections::HashMap;
use std::io::{self, BufRead, BufReader, Read, Write};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

pub const CANCELLED: &str = "Cancelled.";

/// Events for installs and project creation. Process runs use [`crate::process::RunEvent`].
#[derive(Clone, Serialize)]
#[serde(
    tag = "event",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum JobEvent<T: Serialize> {
    Step { message: String },
    Progress { received: u64, total: Option<u64> },
    Log { line: String },
    Done { result: T },
    Failed { message: String, cancelled: bool },
}

#[derive(Default)]
pub struct Tasks {
    next_id: AtomicU32,
    entries: Mutex<HashMap<u32, Arc<TaskHandle>>>,
}

impl Tasks {
    pub fn start(&self) -> (u32, Arc<TaskHandle>) {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        let handle = Arc::new(TaskHandle::default());
        lock(&self.entries).insert(id, handle.clone());
        (id, handle)
    }

    pub fn finish(&self, id: u32) {
        lock(&self.entries).remove(&id);
    }

    pub fn cancel(&self, id: u32) -> bool {
        let handle = lock(&self.entries).get(&id).cloned();
        handle.map(|handle| handle.cancel()).is_some()
    }

    pub fn cancel_all(&self) {
        let handles: Vec<_> = lock(&self.entries).values().cloned().collect();
        for handle in handles {
            handle.cancel();
        }
    }
}

#[derive(Default)]
pub struct TaskHandle {
    cancelled: AtomicBool,
    /// Process id of the running child. Cleared under the same lock that reaps it, so a cancel never
    /// signals a reused process id.
    process: Mutex<Option<u32>>,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Output {
    Stdout,
    Stderr,
}

impl TaskHandle {
    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }

    pub fn check(&self) -> Result<(), String> {
        if self.is_cancelled() {
            Err(CANCELLED.into())
        } else {
            Ok(())
        }
    }

    pub fn cancel(self: &Arc<Self>) {
        self.cancelled.store(true, Ordering::SeqCst);
        // Holding the lock keeps the child unreaped while it is signalled.
        let process = lock(&self.process);
        if let Some(pid) = *process {
            kill_tree(self, pid);
        }
    }

    /// Streams the child's output line by line until it exits, killing its process tree on cancel.
    /// `input` is written to stdin and then closed.
    pub fn watch(
        self: &Arc<Self>,
        mut child: Child,
        input: Option<Vec<u8>>,
        on_line: impl Fn(Output, String) + Send + Sync + 'static,
    ) -> io::Result<ExitStatus> {
        let pid = child.id();
        *lock(&self.process) = Some(pid);
        if self.is_cancelled() {
            kill_tree(self, pid);
        }
        if let Some(mut stdin) = child.stdin.take() {
            let input = input.unwrap_or_default();
            thread::spawn(move || {
                let _ = stdin.write_all(&input);
            });
        }

        let on_line = Arc::new(on_line);
        let (done_sender, done) = mpsc::channel();
        let mut readers = 0;
        if let Some(stdout) = child.stdout.take() {
            readers += 1;
            spawn_reader(stdout, Output::Stdout, on_line.clone(), done_sender.clone());
        }
        if let Some(stderr) = child.stderr.take() {
            readers += 1;
            spawn_reader(stderr, Output::Stderr, on_line, done_sender);
        }

        let status = loop {
            {
                let mut process = lock(&self.process);
                match child.try_wait() {
                    Ok(Some(status)) => {
                        *process = None;
                        break status;
                    }
                    Ok(None) => {}
                    Err(error) => {
                        *process = None;
                        return Err(error);
                    }
                }
            }
            thread::sleep(Duration::from_millis(50));
        };

        // A grandchild that inherited the pipes can keep them open after the child exits.
        let deadline = Instant::now() + Duration::from_secs(2);
        for _ in 0..readers {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if done.recv_timeout(remaining).is_err() {
                break;
            }
        }
        Ok(status)
    }
}

fn spawn_reader(
    stream: impl Read + Send + 'static,
    output: Output,
    on_line: Arc<impl Fn(Output, String) + Send + Sync + 'static>,
    done: mpsc::Sender<()>,
) {
    thread::spawn(move || {
        let mut reader = BufReader::new(stream);
        let mut buffer = Vec::new();
        loop {
            buffer.clear();
            match reader.read_until(b'\n', &mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    // Progress bars redraw with carriage returns; report each redraw as its own line.
                    let text = String::from_utf8_lossy(&buffer);
                    for part in text.trim_end_matches(['\n', '\r']).split('\r') {
                        if !part.is_empty() {
                            on_line(output, part.to_owned());
                        }
                    }
                }
            }
        }
        let _ = done.send(());
    });
}

/// Configures a command for background use: no console window on Windows, its own process group
/// elsewhere so the whole tree can be stopped.
pub fn background(command: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
}

#[cfg(windows)]
fn kill_tree(_handle: &Arc<TaskHandle>, pid: u32) {
    let system_root = std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into());
    let taskkill = std::path::Path::new(&system_root)
        .join("System32")
        .join("taskkill.exe");
    let mut command = Command::new(taskkill);
    command.args(["/PID", &pid.to_string(), "/T", "/F"]);
    let _ = background(&mut command)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

#[cfg(unix)]
fn kill_tree(handle: &Arc<TaskHandle>, pid: u32) {
    let group = pid as libc::pid_t;
    // Let Gradle cancel the build cleanly first.
    // SAFETY: killpg only sends a signal; the group was created for this child by `background`.
    unsafe { libc::killpg(group, libc::SIGTERM) };
    let handle = handle.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_secs(3));
        if *lock(&handle.process) == Some(pid) {
            // SAFETY: as above; the process id is still owned by this unreaped child.
            unsafe { libc::killpg(group, libc::SIGKILL) };
        }
    });
}

pub fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[tauri::command]
pub fn cancel(tasks: tauri::State<'_, Tasks>, id: u32) -> bool {
    tasks.cancel(id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shell(script: &str) -> Command {
        #[cfg(windows)]
        {
            let mut command = Command::new("cmd.exe");
            command.args(["/d", "/c", script]);
            command
        }
        #[cfg(unix)]
        {
            let mut command = Command::new("sh");
            command.args(["-c", script]);
            command
        }
    }

    #[test]
    fn streams_lines_from_both_outputs() {
        let tasks = Tasks::default();
        let (id, handle) = tasks.start();
        let lines = Arc::new(Mutex::new(Vec::new()));
        let sink = lines.clone();
        let child = background(&mut shell("echo one&& echo two 1>&2"))
            .spawn()
            .unwrap();
        let status = handle
            .watch(child, None, move |output, line| {
                lock(&sink).push((output, line.trim().to_owned()))
            })
            .unwrap();
        assert!(status.success());
        let lines = lock(&lines);
        assert!(lines.contains(&(Output::Stdout, "one".into())));
        assert!(lines.contains(&(Output::Stderr, "two".into())));
        tasks.finish(id);
        assert!(!tasks.cancel(id));
    }

    #[test]
    fn cancel_stops_the_whole_process_tree() {
        let temp = tempfile::tempdir().unwrap();
        let marker = temp.path().join("survived");
        let tasks = Arc::new(Tasks::default());
        let (id, handle) = tasks.start();
        // A background grandchild writes the marker after three seconds unless the whole tree is stopped.
        #[cfg(windows)]
        let script = format!("start /b cmd /d /c \"ping -n 4 127.0.0.1 >nul & echo x>{}\" & ping -n 60 127.0.0.1 >nul", marker.display());
        #[cfg(unix)]
        let script = format!("(sleep 3; echo x > '{}') & sleep 60", marker.display());
        let child = background(&mut shell(&script)).spawn().unwrap();
        let canceller = tasks.clone();
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(500));
            assert!(canceller.cancel(id));
        });
        let started = Instant::now();
        let status = handle.watch(child, None, |_, _| {}).unwrap();
        assert!(!status.success());
        assert!(handle.is_cancelled());
        assert!(
            started.elapsed() < Duration::from_secs(6),
            "took {:?}",
            started.elapsed()
        );
        assert_eq!(handle.check(), Err(CANCELLED.to_string()));
        thread::sleep(Duration::from_secs(5));
        assert!(!marker.exists(), "a grandchild process kept running");
    }

    #[test]
    fn writes_input_then_closes_stdin() {
        let (_, handle) = Tasks::default().start();
        // Both commands read until end of input, so the test also proves stdin is closed.
        #[cfg(windows)]
        let script = "sort";
        #[cfg(unix)]
        let script = "cat";
        let mut command = shell(script);
        background(&mut command).stdin(Stdio::piped());
        let lines = Arc::new(Mutex::new(Vec::new()));
        let sink = lines.clone();
        handle
            .watch(
                command.spawn().unwrap(),
                Some(b"y\r\n".to_vec()),
                move |_, line| lock(&sink).push(line),
            )
            .unwrap();
        assert_eq!(
            lock(&lines)
                .iter()
                .map(|line| line.trim())
                .collect::<Vec<_>>(),
            ["y"]
        );
    }
}
