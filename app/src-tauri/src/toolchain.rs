//! Finds the Java and Android tools that FTC robot projects build with, and installs missing ones
//! from their official download servers into the app's data folder.

use crate::download;
use crate::embedded;
use crate::tasks::{background, JobEvent, TaskHandle, Tasks};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use std::thread;
use std::time::Duration;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, Runtime, State};

pub const LICENSE_REQUIRED: &str =
    "Accept the Android SDK License to install the Android build tools.";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pins {
    pub java: JavaPins,
    pub android_command_line_tools: CommandLineToolsPins,
    pub android_packages: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JavaPins {
    pub name: String,
    pub version: String,
    pub supported_major_versions: [u32; 2],
    pub downloads: BTreeMap<String, Pin>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandLineToolsPins {
    pub name: String,
    pub version: String,
    pub license_url: String,
    pub downloads: BTreeMap<String, Pin>,
}

#[derive(Deserialize)]
pub struct Pin {
    pub url: String,
    pub sha256: String,
}

pub fn pins() -> &'static Pins {
    static PINS: OnceLock<Pins> = OnceLock::new();
    PINS.get_or_init(|| {
        serde_json::from_str(embedded::TOOLCHAIN_JSON).expect("toolchain.json is valid")
    })
}

/// The download for this operating system and processor, if the tool is published for it.
pub fn platform_pin(downloads: &BTreeMap<String, Pin>) -> Option<&Pin> {
    let (os, arch) = (env::consts::OS, env::consts::ARCH);
    downloads
        .get(&format!("{os}-{arch}"))
        .or_else(|| downloads.get(os))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Source {
    AndroidStudio,
    JavaHome,
    AndroidHome,
    DefaultLocation,
    App,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Java {
    pub home: PathBuf,
    pub version: String,
    pub major: u32,
    pub source: Source,
    pub supported: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AndroidSdk {
    pub path: PathBuf,
    pub source: Source,
    pub missing_packages: Vec<String>,
    pub license_accepted: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallInfo {
    pub java: String,
    pub command_line_tools: String,
    pub license_url: String,
    pub location: PathBuf,
    /// False when no official download exists for this computer.
    pub available: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolchainStatus {
    /// The Java used for builds: the first supported one found.
    pub java: Option<Java>,
    /// Every Java found, including unsupported versions, so the app can explain what it saw.
    pub java_found: Vec<Java>,
    pub android_sdk: Option<AndroidSdk>,
    pub adb: Option<PathBuf>,
    /// `java`, `androidSdk`, or Android SDK package ids.
    pub missing: Vec<String>,
    pub ready: bool,
    pub install: InstallInfo,
}

/// Where to look for tools. Built from the environment in the app and from temporary folders in tests.
pub struct Search {
    pub java: Vec<(PathBuf, Source)>,
    pub sdks: Vec<(PathBuf, Source)>,
    pub app_dir: PathBuf,
}

impl Search {
    pub fn from_environment(app_dir: &Path) -> Self {
        let var = |name: &str| {
            env::var_os(name)
                .filter(|value| !value.is_empty())
                .map(PathBuf::from)
        };
        let mut java = Vec::new();
        for home in android_studio_java_homes() {
            java.push((home, Source::AndroidStudio));
        }
        if let Some(home) = var("JAVA_HOME") {
            java.push((home, Source::JavaHome));
        }
        java.push((app_dir.join("jdk"), Source::App));
        java.push((
            app_dir.join("jdk").join("Contents").join("Home"),
            Source::App,
        ));

        let mut sdks = Vec::new();
        for name in ["ANDROID_HOME", "ANDROID_SDK_ROOT"] {
            if let Some(path) = var(name) {
                sdks.push((path, Source::AndroidHome));
            }
        }
        if let Some(path) = default_sdk_location() {
            sdks.push((path, Source::DefaultLocation));
        }
        sdks.push((app_dir.join("android-sdk"), Source::App));
        Search {
            java,
            sdks,
            app_dir: app_dir.to_path_buf(),
        }
    }
}

fn home() -> Option<PathBuf> {
    env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from)
}

fn android_studio_java_homes() -> Vec<PathBuf> {
    let mut homes = Vec::new();
    if cfg!(windows) {
        for base in ["ProgramFiles", "ProgramW6432"]
            .iter()
            .filter_map(env::var_os)
        {
            homes.push(
                PathBuf::from(base)
                    .join("Android")
                    .join("Android Studio")
                    .join("jbr"),
            );
        }
        if let Some(local) = env::var_os("LOCALAPPDATA") {
            homes.push(
                PathBuf::from(local)
                    .join("Programs")
                    .join("Android Studio")
                    .join("jbr"),
            );
        }
    } else if cfg!(target_os = "macos") {
        let bundle = Path::new("Android Studio.app")
            .join("Contents")
            .join("jbr")
            .join("Contents")
            .join("Home");
        homes.push(Path::new("/Applications").join(&bundle));
        if let Some(home) = home() {
            homes.push(home.join("Applications").join(&bundle));
        }
    } else {
        for base in [
            "/opt/android-studio",
            "/usr/local/android-studio",
            "/snap/android-studio/current",
        ] {
            homes.push(Path::new(base).join("jbr"));
        }
        if let Some(home) = home() {
            homes.push(home.join("android-studio").join("jbr"));
        }
    }
    homes.dedup();
    homes
}

fn default_sdk_location() -> Option<PathBuf> {
    if cfg!(windows) {
        env::var_os("LOCALAPPDATA").map(|local| PathBuf::from(local).join("Android").join("Sdk"))
    } else if cfg!(target_os = "macos") {
        home().map(|home| home.join("Library").join("Android").join("sdk"))
    } else {
        home().map(|home| home.join("Android").join("Sdk"))
    }
}

fn executable(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_owned()
    }
}

/// Reads a Java installation from its `release` file, without running it.
pub fn read_java(home: &Path, source: Source) -> Option<Java> {
    if !home.join("bin").join(executable("java")).is_file() {
        return None;
    }
    let release = fs::read_to_string(home.join("release")).ok()?;
    let version = release
        .lines()
        .find_map(|line| line.strip_prefix("JAVA_VERSION="))?
        .trim()
        .trim_matches('"')
        .to_owned();
    let mut parts = version.split(['.', '_', '+', '-']);
    let first: u32 = parts.next()?.parse().ok()?;
    let major = if first == 1 {
        parts.next()?.parse().ok()?
    } else {
        first
    };
    let [low, high] = pins().java.supported_major_versions;
    Some(Java {
        home: home.to_path_buf(),
        version,
        major,
        source,
        supported: (low..=high).contains(&major),
    })
}

fn package_installed(sdk: &Path, package: &str) -> bool {
    let directory = package
        .split(';')
        .fold(sdk.to_path_buf(), |path, part| path.join(part));
    if package == "platform-tools" {
        return directory.join(executable("adb")).is_file();
    }
    directory.join("package.xml").is_file() || directory.join("source.properties").is_file()
}

pub fn read_sdk(path: &Path, source: Source) -> Option<AndroidSdk> {
    if !path.is_dir() {
        return None;
    }
    let missing_packages = pins()
        .android_packages
        .iter()
        .filter(|package| !package_installed(path, package))
        .cloned()
        .collect();
    let license_accepted = fs::metadata(path.join("licenses").join("android-sdk-license"))
        .is_ok_and(|meta| meta.len() > 0);
    Some(AndroidSdk {
        path: path.to_path_buf(),
        source,
        missing_packages,
        license_accepted,
    })
}

pub fn detect(search: &Search) -> ToolchainStatus {
    let mut java_found: Vec<Java> = Vec::new();
    for (home, source) in &search.java {
        if let Some(java) = read_java(home, *source) {
            if !java_found.iter().any(|found| found.home == java.home) {
                java_found.push(java);
            }
        }
    }
    let java = java_found.iter().find(|java| java.supported).cloned();

    let sdks: Vec<AndroidSdk> = search
        .sdks
        .iter()
        .filter_map(|(path, source)| read_sdk(path, *source))
        .collect();
    // Prefer a complete SDK; otherwise the first one found receives the missing packages.
    let android_sdk = sdks
        .iter()
        .find(|sdk| sdk.missing_packages.is_empty())
        .or(sdks.first())
        .cloned();
    let adb = android_sdk
        .as_ref()
        .map(|sdk| sdk.path.join("platform-tools").join(executable("adb")))
        .filter(|adb| adb.is_file());

    let mut missing = Vec::new();
    if java.is_none() {
        missing.push("java".to_owned());
    }
    match &android_sdk {
        Some(sdk) => missing.extend(sdk.missing_packages.iter().cloned()),
        None => missing.push("androidSdk".to_owned()),
    }
    let pins = pins();
    ToolchainStatus {
        java,
        java_found,
        android_sdk,
        adb,
        ready: missing.is_empty(),
        missing,
        install: InstallInfo {
            java: format!("{} {}", pins.java.name, pins.java.version),
            command_line_tools: format!(
                "{} {}",
                pins.android_command_line_tools.name, pins.android_command_line_tools.version
            ),
            license_url: pins.android_command_line_tools.license_url.clone(),
            location: search.app_dir.clone(),
            available: platform_pin(&pins.java.downloads).is_some()
                && platform_pin(&pins.android_command_line_tools.downloads).is_some(),
        },
    }
}

pub struct Dirs {
    pub toolchain: PathBuf,
    pub cache: PathBuf,
}

impl Dirs {
    pub fn of<R: Runtime>(app: &AppHandle<R>) -> Result<Self, String> {
        let paths = app.path();
        let local = paths
            .app_local_data_dir()
            .map_err(|error| format!("Could not find the app data folder: {error}"))?;
        let cache = paths
            .app_cache_dir()
            .map_err(|error| format!("Could not find the app cache folder: {error}"))?;
        Ok(Dirs {
            toolchain: local.join("toolchain"),
            cache: cache.join("downloads"),
        })
    }
}

pub fn current_status<R: Runtime>(app: &AppHandle<R>) -> Result<ToolchainStatus, String> {
    Ok(detect(&Search::from_environment(&Dirs::of(app)?.toolchain)))
}

#[tauri::command(async)]
pub fn toolchain_status<R: Runtime>(app: AppHandle<R>) -> Result<ToolchainStatus, String> {
    current_status(&app)
}

type Emit = Arc<dyn Fn(JobEvent<ToolchainStatus>) + Send + Sync>;

static INSTALLING: AtomicBool = AtomicBool::new(false);

/// Starts installing whatever is missing and returns a task id for `cancel`. Progress, the final
/// status, or the failure arrive on `on_event`.
#[tauri::command(async)]
pub fn toolchain_install<R: Runtime>(
    app: AppHandle<R>,
    tasks: State<'_, Tasks>,
    accept_android_sdk_license: bool,
    on_event: Channel<JobEvent<ToolchainStatus>>,
) -> Result<u32, String> {
    let dirs = Dirs::of(&app)?;
    let status = detect(&Search::from_environment(&dirs.toolchain));
    if status.missing.iter().any(|item| item != "java") && !accept_android_sdk_license {
        return Err(LICENSE_REQUIRED.into());
    }
    if INSTALLING.swap(true, Ordering::SeqCst) {
        return Err("The build tools are already being installed.".into());
    }
    let (id, task) = tasks.start();
    thread::spawn(move || {
        let emit: Emit = Arc::new(move |event| {
            let _ = on_event.send(event);
        });
        match install(&dirs, &task, &emit) {
            Ok(status) => emit(JobEvent::Done { result: status }),
            Err(message) => emit(JobEvent::Failed {
                cancelled: task.is_cancelled(),
                message,
            }),
        }
        INSTALLING.store(false, Ordering::SeqCst);
        app.state::<Tasks>().finish(id);
    });
    Ok(id)
}

/// Installs missing tools. The caller has already obtained license acceptance for Android packages.
pub fn install(
    dirs: &Dirs,
    task: &Arc<TaskHandle>,
    emit: &Emit,
) -> Result<ToolchainStatus, String> {
    let search = Search::from_environment(&dirs.toolchain);
    let pins = pins();
    let mut status = detect(&search);
    let progress = |emit: &Emit| {
        let emit = emit.clone();
        move |received, total| emit(JobEvent::Progress { received, total })
    };

    if status.java.is_none() {
        let pin = platform_pin(&pins.java.downloads).ok_or(
            "Java is not published for this kind of computer. Install Android Studio instead.",
        )?;
        emit(JobEvent::Step {
            message: format!("Downloading {} {}", pins.java.name, pins.java.version),
        });
        let archive = download::fetch(&pin.url, &pin.sha256, &dirs.cache, task, &progress(emit))?;
        emit(JobEvent::Step {
            message: format!("Installing {}", pins.java.name),
        });
        install_archive(&archive, &pin.url, &dirs.toolchain, "jdk", task)?;
        status = detect(&search);
        if status.java.is_none() {
            return Err("Java was installed but could not be verified.".into());
        }
    }

    if status.missing.iter().any(|item| item != "java") {
        let java = status.java.clone().expect("Java was verified above");
        let app_sdk = dirs.toolchain.join("android-sdk");
        let sdk_root = status
            .android_sdk
            .as_ref()
            .map_or(app_sdk.clone(), |sdk| sdk.path.clone());
        let sdkmanager = match find_sdkmanager(&sdk_root).or_else(|| find_sdkmanager(&app_sdk)) {
            Some(path) => path,
            None => {
                let tools = &pins.android_command_line_tools;
                let pin = platform_pin(&tools.downloads).ok_or(
                    "The Android command-line tools are not published for this kind of computer.",
                )?;
                emit(JobEvent::Step {
                    message: format!("Downloading {} {}", tools.name, tools.version),
                });
                let archive =
                    download::fetch(&pin.url, &pin.sha256, &dirs.cache, task, &progress(emit))?;
                emit(JobEvent::Step {
                    message: format!("Installing {}", tools.name),
                });
                install_archive(
                    &archive,
                    &pin.url,
                    &app_sdk.join("cmdline-tools"),
                    "latest",
                    task,
                )?;
                find_sdkmanager(&app_sdk).ok_or(
                    "The Android command-line tools were installed but could not be found.",
                )?
            }
        };
        let packages: Vec<String> = match &status.android_sdk {
            Some(sdk) => sdk.missing_packages.clone(),
            None => pins.android_packages.clone(),
        };
        emit(JobEvent::Step {
            message: format!("Installing Android SDK packages: {}", packages.join(", ")),
        });
        fs::create_dir_all(&sdk_root)
            .map_err(|error| format!("Could not create {}: {error}", sdk_root.display()))?;
        let mut command = Command::new(&sdkmanager);
        command
            .arg(format!("--sdk_root={}", sdk_root.display()))
            .arg("--install")
            .args(&packages);
        background(&mut command)
            .stdin(Stdio::piped())
            .env("JAVA_HOME", &java.home);
        let child = command
            .spawn()
            .map_err(|error| format!("Could not start the Android SDK Manager: {error}"))?;
        // The license was accepted in the app; answer the SDK Manager's license prompts the same way.
        let log = emit.clone();
        let exit = task
            .watch(child, Some(b"y\n".repeat(16)), move |_, line| {
                log(JobEvent::Log { line })
            })
            .map_err(|error| format!("The Android SDK Manager stopped unexpectedly: {error}"))?;
        task.check()?;
        if !exit.success() {
            return Err(format!(
                "The Android SDK Manager failed ({exit}). The log above has the details."
            ));
        }
        status = detect(&search);
    }

    if !status.ready {
        return Err(format!(
            "Installation finished, but these are still missing: {}.",
            status.missing.join(", ")
        ));
    }
    Ok(status)
}

fn find_sdkmanager(sdk: &Path) -> Option<PathBuf> {
    let name = if cfg!(windows) {
        "sdkmanager.bat"
    } else {
        "sdkmanager"
    };
    let path = sdk
        .join("cmdline-tools")
        .join("latest")
        .join("bin")
        .join(name);
    path.is_file().then_some(path)
}

/// Extracts an archive with one top-level folder and moves that folder to `parent/name`, replacing an
/// earlier copy the app installed there.
fn install_archive(
    archive: &Path,
    url: &str,
    parent: &Path,
    name: &str,
    task: &TaskHandle,
) -> Result<(), String> {
    let target = parent.join(name);
    let staging = parent.join(format!(".{name}-staging"));
    let io =
        |error: std::io::Error| format!("Could not install into {}: {error}", parent.display());
    if staging.exists() {
        fs::remove_dir_all(&staging).map_err(io)?;
    }
    fs::create_dir_all(&staging).map_err(io)?;
    let result = (|| {
        if url.ends_with(".zip") {
            download::extract_zip(archive, &staging, task)?;
        } else {
            download::extract_tar_gz(archive, &staging, task)?;
        }
        let entries: Vec<PathBuf> = fs::read_dir(&staging)
            .map_err(io)?
            .filter_map(|entry| entry.ok().map(|entry| entry.path()))
            .collect();
        let [top] = entries.as_slice() else {
            return Err("The downloaded archive has an unexpected layout.".to_owned());
        };
        if target.exists() {
            fs::remove_dir_all(&target).map_err(io)?;
        }
        rename_with_retry(top, &target).map_err(io)
    })();
    let _ = fs::remove_dir_all(&staging);
    result
}

/// Virus scanners briefly lock freshly extracted files on Windows.
fn rename_with_retry(from: &Path, to: &Path) -> std::io::Result<()> {
    let mut attempt = 0;
    loop {
        match fs::rename(from, to) {
            Ok(()) => return Ok(()),
            Err(_) if attempt < 10 => {
                attempt += 1;
                thread::sleep(Duration::from_millis(300));
            }
            Err(error) => return Err(error),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fake_java(home: &Path, version: &str) {
        fs::create_dir_all(home.join("bin")).unwrap();
        fs::write(home.join("bin").join(executable("java")), "").unwrap();
        fs::write(
            home.join("release"),
            format!("IMPLEMENTOR=\"Test\"\nJAVA_VERSION=\"{version}\"\n"),
        )
        .unwrap();
    }

    fn fake_package(sdk: &Path, package: &str) {
        let directory = package
            .split(';')
            .fold(sdk.to_path_buf(), |path, part| path.join(part));
        fs::create_dir_all(&directory).unwrap();
        fs::write(directory.join("package.xml"), "").unwrap();
        if package == "platform-tools" {
            fs::write(directory.join(executable("adb")), "").unwrap();
        }
    }

    #[test]
    fn pins_cover_supported_computers() {
        let pins = pins();
        for key in [
            "windows-x86_64",
            "windows-aarch64",
            "macos-x86_64",
            "macos-aarch64",
            "linux-x86_64",
            "linux-aarch64",
        ] {
            let pin = &pins.java.downloads[key];
            assert!(pin.url.starts_with("https://github.com/adoptium/"), "{key}");
            assert_eq!(pin.sha256.len(), 64);
        }
        for key in ["windows", "macos", "linux"] {
            let pin = &pins.android_command_line_tools.downloads[key];
            assert!(
                pin.url
                    .starts_with("https://dl.google.com/android/repository/"),
                "{key}"
            );
            assert_eq!(pin.sha256.len(), 64);
        }
        assert!(pins
            .android_packages
            .contains(&"platforms;android-34".to_owned()));
        assert!(platform_pin(&pins.java.downloads).is_some());
    }

    #[test]
    fn reads_java_versions_from_release_files() {
        let temp = tempfile::tempdir().unwrap();
        let cases = [
            ("21.0.6", 21, true),
            ("17", 17, true),
            ("1.8.0_392", 8, false),
            ("25", 25, false),
        ];
        for (version, major, supported) in cases {
            let home = temp.path().join(version);
            fake_java(&home, version);
            let java = read_java(&home, Source::JavaHome).unwrap();
            assert_eq!(
                (java.major, java.supported),
                (major, supported),
                "{version}"
            );
        }
        let broken = temp.path().join("broken");
        fs::create_dir_all(&broken).unwrap();
        assert_eq!(read_java(&broken, Source::JavaHome), None);
    }

    #[test]
    fn detects_the_first_supported_java_and_a_complete_sdk() {
        let temp = tempfile::tempdir().unwrap();
        let studio = temp.path().join("studio-jbr");
        let java_home = temp.path().join("java-home");
        fake_java(&studio, "11.0.2");
        fake_java(&java_home, "17.0.9");
        let partial = temp.path().join("partial-sdk");
        fake_package(&partial, "platforms;android-30");
        let complete = temp.path().join("complete-sdk");
        for package in &pins().android_packages {
            fake_package(&complete, package);
        }
        let search = Search {
            java: vec![
                (studio, Source::AndroidStudio),
                (java_home.clone(), Source::JavaHome),
                (temp.path().join("missing"), Source::App),
            ],
            sdks: vec![
                (partial.clone(), Source::AndroidHome),
                (complete.clone(), Source::DefaultLocation),
            ],
            app_dir: temp.path().to_path_buf(),
        };
        let status = detect(&search);
        assert_eq!(
            status.java.as_ref().map(|java| &java.home),
            Some(&java_home)
        );
        assert_eq!(status.java_found.len(), 2);
        assert_eq!(
            status.android_sdk.as_ref().map(|sdk| &sdk.path),
            Some(&complete)
        );
        assert_eq!(
            status.adb,
            Some(complete.join("platform-tools").join(executable("adb")))
        );
        assert!(status.ready, "{:?}", status.missing);

        let search = Search {
            sdks: vec![(partial.clone(), Source::AndroidHome)],
            ..search
        };
        let status = detect(&search);
        assert!(!status.ready);
        assert_eq!(status.android_sdk.unwrap().path, partial);
        assert!(status.missing.contains(&"platforms;android-34".to_owned()));
        assert!(!status.missing.contains(&"platforms;android-30".to_owned()));
        assert_eq!(status.adb, None);
    }

    #[test]
    fn reports_missing_java_and_sdk() {
        let temp = tempfile::tempdir().unwrap();
        let search = Search {
            java: vec![],
            sdks: vec![(temp.path().join("none"), Source::App)],
            app_dir: temp.path().to_path_buf(),
        };
        let status = detect(&search);
        assert_eq!(status.missing, ["java", "androidSdk"]);
        assert!(status.install.available);
    }

    #[test]
    fn finds_the_app_installed_java_on_every_layout() {
        let temp = tempfile::tempdir().unwrap();
        // macOS archives keep the Java home inside a bundle.
        fake_java(
            &temp.path().join("jdk").join("Contents").join("Home"),
            "21.0.12.1",
        );
        let status = detect(&Search::from_environment(temp.path()));
        assert!(status
            .java_found
            .iter()
            .any(|java| java.source == Source::App && java.major == 21));
    }

    #[test]
    fn license_is_read_from_the_sdk() {
        let temp = tempfile::tempdir().unwrap();
        assert!(!read_sdk(temp.path(), Source::App).unwrap().license_accepted);
        fs::create_dir_all(temp.path().join("licenses")).unwrap();
        fs::write(
            temp.path().join("licenses").join("android-sdk-license"),
            "\nabc",
        )
        .unwrap();
        assert!(read_sdk(temp.path(), Source::App).unwrap().license_accepted);
    }

    /// Installs everything into a temporary folder from the real download servers (about 700 MB).
    /// Run with `cargo test real_install -- --ignored --nocapture`.
    #[test]
    #[ignore = "downloads the JDK and Android SDK"]
    fn real_install() {
        let root = env::var_os("TOOLCHAIN_TEST_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| env::temp_dir().join("toolchain-install-test"));
        let dirs = Dirs {
            toolchain: root.join("toolchain"),
            cache: root.join("cache"),
        };
        // Isolate from tools already on this computer: tool locations point nowhere, home is empty.
        fs::create_dir_all(root.join("home")).unwrap();
        for (name, value) in [
            ("JAVA_HOME", "missing"),
            ("ANDROID_HOME", "missing"),
            ("ANDROID_SDK_ROOT", "missing"),
            ("LOCALAPPDATA", "missing"),
            ("ProgramFiles", "missing"),
            ("ProgramW6432", "missing"),
            ("HOME", "home"),
            ("USERPROFILE", "home"),
        ] {
            // SAFETY: this ignored test runs alone (`cargo test real_install -- --ignored`).
            unsafe { env::set_var(name, root.join(value)) };
        }
        let (_, task) = Tasks::default().start();
        let emit: Emit = Arc::new(|event| match event {
            JobEvent::Progress { .. } => {}
            JobEvent::Step { message } => println!("step: {message}"),
            JobEvent::Log { line } => println!("  {line}"),
            _ => {}
        });
        let status = install(&dirs, &task, &emit).unwrap_or_else(|error| panic!("{error}"));
        println!("{}", serde_json::to_string_pretty(&status).unwrap());
        assert!(status.ready);
        assert_eq!(status.java.unwrap().source, Source::App);
        assert_eq!(status.android_sdk.unwrap().source, Source::App);
    }
}
