//! The desktop backend: finding and installing build tools, creating robot projects, and running the
//! project's Gradle wrapper or adb. Files are read and written by the frontend through the fs plugin.

mod download;
mod process;
mod quickstart;
mod tasks;
mod toolchain;

mod embedded {
    include!(concat!(env!("OUT_DIR"), "/embedded.rs"));
}

use tauri::{Builder, Manager, Runtime};

/// Registers the backend's state and commands. Shared by the app and the IPC tests.
fn commands<R: Runtime>(builder: Builder<R>) -> Builder<R> {
    builder
        .manage(tasks::Tasks::default())
        .invoke_handler(tauri::generate_handler![
            toolchain::toolchain_status,
            toolchain::toolchain_install,
            quickstart::quickstart_create,
            quickstart::sdk_add_libraries,
            process::run,
            tasks::cancel,
        ])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        // Remembers project folders the user opened; must come after the fs plugin.
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_dialog::init());
    commands(builder)
        .build(tauri::generate_context!())
        .expect("error while building application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                // Builds and simulators started from the app stop with it.
                app.state::<tasks::Tasks>().cancel_all();
            }
        });
}

#[cfg(test)]
mod ipc {
    use serde_json::{json, Value};
    use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY};
    use tauri::webview::InvokeRequest;
    use tauri::WebviewWindowBuilder;

    /// Calls a command the way the frontend does, with camelCase argument names.
    fn call(cmd: &str, body: Value) -> Result<Value, Value> {
        let app = super::commands(mock_builder())
            .build(mock_context(noop_assets()))
            .unwrap();
        let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        get_ipc_response(
            &webview,
            InvokeRequest {
                cmd: cmd.into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                // The app's own origin, the only one allowed to call commands. Tauri serves it as
                // http://tauri.localhost on Windows and tauri://localhost on macOS and Linux.
                url: if cfg!(windows) {
                    "http://tauri.localhost"
                } else {
                    "tauri://localhost"
                }
                .parse()
                .unwrap(),
                body: tauri::ipc::InvokeBody::Json(body),
                headers: Default::default(),
                invoke_key: INVOKE_KEY.to_string(),
            },
        )
        .map(|response| response.deserialize::<Value>().unwrap())
    }

    fn error_text(result: Result<Value, Value>) -> String {
        result.expect_err("expected an error").to_string()
    }

    #[test]
    fn reports_toolchain_status() {
        let status = call("toolchain_status", json!({})).unwrap();
        assert!(status["ready"].is_boolean());
        assert!(status["install"]["licenseUrl"]
            .as_str()
            .unwrap()
            .starts_with("https://developer.android.com/"));
        assert!(status["javaFound"].is_array() && status["missing"].is_array());
    }

    #[test]
    fn run_accepts_the_frontend_request_shape() {
        let body = json!({ "request": { "tool": "gradle", "args": ["tasks"], "cwd": "relative", "env": {} }, "onEvent": "__CHANNEL__:1" });
        assert!(error_text(call("run", body)).contains("is not a folder"));
        let body = json!({ "request": { "tool": "powershell", "args": [], "cwd": "/" }, "onEvent": "__CHANNEL__:1" });
        assert!(error_text(call("run", body)).contains("unknown variant"));
    }

    #[test]
    fn long_running_commands_name_their_arguments_in_camel_case() {
        assert!(error_text(call(
            "toolchain_install",
            json!({ "onEvent": "__CHANNEL__:1" })
        ))
        .contains("acceptAndroidSdkLicense"));
        assert!(error_text(call(
            "quickstart_create",
            json!({ "onEvent": "__CHANNEL__:1" })
        ))
        .contains("destination"));
        assert!(error_text(call(
            "sdk_add_libraries",
            json!({ "folder": "C:/robot", "onEvent": "__CHANNEL__:1" })
        ))
        .contains("includePedroSetup"));
        assert_eq!(
            call("cancel", json!({ "id": 12345 })).unwrap(),
            json!(false)
        );
    }
}

#[cfg(test)]
mod end_to_end {
    use crate::process::{command_for, RunRequest, Tool};
    use crate::quickstart::{self, RobotLibrary};
    use crate::tasks::Tasks;
    use crate::toolchain::{detect, Search, Source};
    use std::collections::BTreeMap;
    use std::path::PathBuf;
    use std::sync::Arc;

    /// Creates a robot project and builds and tests it with only the tools `toolchain::tests::real_install`
    /// put in TOOLCHAIN_TEST_DIR: no Android Studio, no local.properties. Run that test first, then
    /// `cargo test builds_a_new_project_with_installed_tools -- --ignored --nocapture`.
    #[test]
    #[ignore = "needs installed tools and several minutes"]
    fn builds_a_new_project_with_installed_tools() {
        let root =
            PathBuf::from(std::env::var_os("TOOLCHAIN_TEST_DIR").expect("TOOLCHAIN_TEST_DIR"));
        for name in [
            "JAVA_HOME",
            "ANDROID_HOME",
            "ANDROID_SDK_ROOT",
            "LOCALAPPDATA",
            "ProgramFiles",
            "ProgramW6432",
        ] {
            // SAFETY: this ignored test runs alone.
            unsafe { std::env::set_var(name, root.join("missing")) };
        }
        let status = detect(&Search::from_environment(&root.join("toolchain")));
        assert!(status.ready, "{:?}", status.missing);
        assert_eq!(status.java.as_ref().unwrap().source, Source::App);

        let project = root.join("project");
        let _ = std::fs::remove_dir_all(&project);
        let (_, task) = Tasks::default().start();
        let quiet: quickstart::Emit = Arc::new(|_| {});
        quickstart::create(
            &project,
            RobotLibrary::Local,
            &root.join("cache"),
            &task,
            &quiet,
        )
        .unwrap_or_else(|error| panic!("{error}"));
        assert!(!project.join("local.properties").exists());

        let request = RunRequest {
            tool: Tool::Gradle,
            args: [
                ":TeamCode:assembleDebug",
                ":TeamCode:testDebugUnitTest",
                "--no-daemon",
            ]
            .map(String::from)
            .to_vec(),
            cwd: project,
            env: BTreeMap::new(),
        };
        let mut command = command_for(&request, &status).unwrap();
        let exit = task
            .watch(command.spawn().unwrap(), None, |_, line| println!("{line}"))
            .unwrap();
        assert!(exit.success(), "{exit}");
    }
}
