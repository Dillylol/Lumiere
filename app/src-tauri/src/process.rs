//! Runs the robot project's Gradle wrapper or adb. No other programs can be started from the app.

use crate::tasks::{background, Output, Tasks};
use crate::toolchain::{self, ToolchainStatus};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::process::Command;
use std::thread;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, Runtime, State};

/// Environment variables the app may pass through. `SIM_TOKEN` authenticates the simulator connection
/// without putting the token in the process list.
pub const ALLOWED_ENVIRONMENT: &[&str] = &["SIM_TOKEN"];
const MAX_ARGUMENTS: usize = 200;
const MAX_ARGUMENT_LENGTH: usize = 4096;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Tool {
    Gradle,
    Adb,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunRequest {
    pub tool: Tool,
    #[serde(default)]
    pub args: Vec<String>,
    /// The robot project folder (the one containing `gradlew`).
    pub cwd: PathBuf,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(
    tag = "event",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum RunEvent {
    Stdout { line: String },
    Stderr { line: String },
    Exit { code: Option<i32>, cancelled: bool },
    Error { message: String },
}

fn check_text(kind: &str, text: &str) -> Result<(), String> {
    if text.len() > MAX_ARGUMENT_LENGTH || text.chars().any(char::is_control) {
        return Err(format!("The {kind} {text:?} is not allowed."));
    }
    Ok(())
}

/// Builds the command for a request. Pure apart from checking that files exist, so it is unit tested.
pub fn command_for(request: &RunRequest, toolchain: &ToolchainStatus) -> Result<Command, String> {
    if request.args.len() > MAX_ARGUMENTS {
        return Err("Too many arguments.".into());
    }
    for arg in &request.args {
        check_text("argument", arg)?;
    }
    for (key, value) in &request.env {
        if !ALLOWED_ENVIRONMENT.contains(&key.as_str()) {
            return Err(format!(
                "The environment variable {key} cannot be set from the app."
            ));
        }
        check_text("environment value", value)?;
    }
    if !request.cwd.is_absolute() || !request.cwd.is_dir() {
        return Err(format!("{} is not a folder.", request.cwd.display()));
    }

    let mut command = match request.tool {
        Tool::Gradle => {
            let java = toolchain
                .java
                .as_ref()
                .ok_or("No supported Java was found. Install the build tools first.")?;
            let mut command = if cfg!(windows) {
                let wrapper = request.cwd.join("gradlew.bat");
                if !wrapper.is_file() {
                    return Err(
                        "This folder is not a Gradle robot project (gradlew.bat is missing)."
                            .into(),
                    );
                }
                // The standard library quotes batch-file arguments safely and refuses any it cannot.
                Command::new(wrapper)
            } else {
                let wrapper = request.cwd.join("gradlew");
                if !wrapper.is_file() {
                    return Err(
                        "This folder is not a Gradle robot project (gradlew is missing).".into(),
                    );
                }
                // Running through sh works even when the executable bit was lost when copying the project.
                let mut command = Command::new("sh");
                command.arg(wrapper);
                command
            };
            if !request.args.iter().any(|arg| arg.starts_with("--console")) {
                command.arg("--console=plain");
            }
            command.env("JAVA_HOME", &java.home);
            command.env_remove("ANDROID_SDK_ROOT");
            if let Some(sdk) = &toolchain.android_sdk {
                command.env("ANDROID_HOME", &sdk.path);
            }
            command
        }
        Tool::Adb => Command::new(
            toolchain
                .adb
                .as_ref()
                .ok_or("adb was not found. Install the build tools first.")?,
        ),
    };
    command
        .args(&request.args)
        .envs(&request.env)
        .current_dir(&request.cwd);
    background(&mut command);
    Ok(command)
}

/// Starts the tool and returns a task id for `cancel`. Output and the exit code arrive on `on_event`.
#[tauri::command(async)]
pub fn run<R: Runtime>(
    app: AppHandle<R>,
    tasks: State<'_, Tasks>,
    request: RunRequest,
    on_event: Channel<RunEvent>,
) -> Result<u32, String> {
    let toolchain = toolchain::current_status(&app)?;
    let mut command = command_for(&request, &toolchain)?;
    let child = command
        .spawn()
        .map_err(|error| format!("Could not start {:?}: {error}", request.tool))?;
    let (id, task) = tasks.start();
    thread::spawn(move || {
        let lines = on_event.clone();
        let result = task.watch(child, None, move |output, line| {
            let _ = lines.send(match output {
                Output::Stdout => RunEvent::Stdout { line },
                Output::Stderr => RunEvent::Stderr { line },
            });
        });
        let _ = on_event.send(match result {
            Ok(status) => RunEvent::Exit {
                code: status.code(),
                cancelled: task.is_cancelled(),
            },
            Err(error) => RunEvent::Error {
                message: error.to_string(),
            },
        });
        app.state::<Tasks>().finish(id);
    });
    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::toolchain::{detect, Java, Search, Source};
    use std::fs;
    use std::sync::{Arc, Mutex};

    fn toolchain(java: bool) -> ToolchainStatus {
        let temp = std::env::temp_dir();
        let mut status = detect(&Search {
            java: vec![],
            sdks: vec![],
            app_dir: temp.clone(),
        });
        if java {
            status.java = Some(Java {
                home: temp.join("fake-java"),
                version: "21".into(),
                major: 21,
                source: Source::App,
                supported: true,
            });
        }
        status
    }

    fn project() -> tempfile::TempDir {
        let temp = tempfile::tempdir().unwrap();
        if cfg!(windows) {
            fs::write(
                temp.path().join("gradlew.bat"),
                "@echo off\r\necho args %*\r\necho java %JAVA_HOME%\r\necho token %SIM_TOKEN%\r\n",
            )
            .unwrap();
        } else {
            fs::write(
                temp.path().join("gradlew"),
                "echo args \"$@\"\necho java \"$JAVA_HOME\"\necho token \"$SIM_TOKEN\"\n",
            )
            .unwrap();
        }
        temp
    }

    fn request(tool: Tool, args: &[&str], cwd: PathBuf) -> RunRequest {
        RunRequest {
            tool,
            args: args.iter().map(|arg| arg.to_string()).collect(),
            cwd,
            env: BTreeMap::new(),
        }
    }

    fn output(mut command: Command) -> Vec<String> {
        let (_, task) = Tasks::default().start();
        let lines = Arc::new(Mutex::new(Vec::new()));
        let sink = lines.clone();
        let status = task
            .watch(command.spawn().unwrap(), None, move |_, line| {
                sink.lock().unwrap().push(line)
            })
            .unwrap();
        assert!(status.success());
        let lines = lines.lock().unwrap().clone();
        lines
    }

    #[test]
    fn only_known_tools_can_be_requested() {
        let parsed: Result<RunRequest, _> =
            serde_json::from_value(serde_json::json!({ "tool": "cmd", "args": [], "cwd": "/" }));
        assert!(parsed.is_err());
        let parsed: RunRequest =
            serde_json::from_value(serde_json::json!({ "tool": "gradle", "cwd": "/" })).unwrap();
        assert_eq!(parsed.tool, Tool::Gradle);
    }

    #[test]
    fn runs_the_project_wrapper_with_the_detected_java() {
        let project = project();
        let mut request = request(
            Tool::Gradle,
            &[
                ":TeamCode:compileDebugJavaWithJavac",
                "-Psim.port=0",
                "two words",
            ],
            project.path().to_path_buf(),
        );
        request
            .env
            .insert("SIM_TOKEN".into(), "abcdefghijklmnop".into());
        let lines = output(command_for(&request, &toolchain(true)).unwrap());
        let args = lines.iter().find(|line| line.starts_with("args")).unwrap();
        assert!(
            args.contains(":TeamCode:compileDebugJavaWithJavac"),
            "{args}"
        );
        assert!(
            args.contains("-Psim.port=0")
                && args.contains("two words")
                && args.contains("--console=plain"),
            "{args}"
        );
        assert!(
            lines
                .iter()
                .any(|line| line.trim_end().ends_with("fake-java")),
            "{lines:?}"
        );
        assert!(
            lines
                .iter()
                .any(|line| line.trim_end() == "token abcdefghijklmnop"),
            "{lines:?}"
        );
    }

    #[test]
    fn shell_metacharacters_stay_inside_arguments() {
        let project = project();
        let request = request(
            Tool::Gradle,
            &["x & echo injected", "y | echo injected", "$(echo injected)"],
            project.path().to_path_buf(),
        );
        let lines = output(command_for(&request, &toolchain(true)).unwrap());
        assert!(
            !lines.iter().any(|line| line.trim() == "injected"),
            "{lines:?}"
        );
    }

    #[test]
    fn rejects_unsafe_requests() {
        let project = project();
        let cwd = project.path().to_path_buf();
        let error = |request: RunRequest, status: &ToolchainStatus| {
            command_for(&request, status).err().unwrap()
        };

        assert!(error(
            request(Tool::Gradle, &["a\nb"], cwd.clone()),
            &toolchain(true)
        )
        .contains("not allowed"));
        let mut env = request(Tool::Gradle, &[], cwd.clone());
        env.env.insert("PATH".into(), "/tmp".into());
        assert!(error(env, &toolchain(true)).contains("cannot be set"));
        assert!(error(
            request(Tool::Gradle, &[], PathBuf::from("relative")),
            &toolchain(true)
        )
        .contains("not a folder"));
        assert!(error(
            request(Tool::Gradle, &[], std::env::temp_dir()),
            &toolchain(true)
        )
        .contains("not a Gradle robot project"));
        assert!(error(request(Tool::Gradle, &[], cwd.clone()), &toolchain(false)).contains("Java"));
        assert!(error(
            request(Tool::Adb, &["devices"], cwd.clone()),
            &toolchain(true)
        )
        .contains("adb"));
        let many: Vec<&str> = vec!["x"; MAX_ARGUMENTS + 1];
        assert!(error(request(Tool::Gradle, &many, cwd), &toolchain(true)).contains("Too many"));
    }
}
