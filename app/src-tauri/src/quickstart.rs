//! Creates a robot project from the official FTC SDK plus the quickstart overlay embedded in the app.
//! Matches `scripts/quickstart.mjs`; upstream code is downloaded at pinned versions and verified.

use crate::download;
use crate::embedded;
use crate::tasks::{JobEvent, TaskHandle, Tasks};
use crate::toolchain::Dirs;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use std::thread;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, Runtime, State};
use tauri_plugin_fs::FsExt;

const TEXT_EXTENSIONS: &[&str] = &[
    "gradle",
    "java",
    "md",
    "yml",
    "yaml",
    "json",
    "properties",
    "txt",
    "xml",
    "kts",
];

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sources {
    pub versions: BTreeMap<String, String>,
    pub ftc_sdk: FtcSdk,
    pub pedro_tuning_procedures: Procedures,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FtcSdk {
    pub tag: String,
    pub url: String,
    pub sha256: String,
    pub strip_prefix: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Procedures {
    pub commit: String,
    pub base_url: String,
    pub files: Vec<ProcedureFile>,
}

#[derive(Deserialize)]
pub struct ProcedureFile {
    pub path: String,
    pub target: Option<String>,
    pub sha256: String,
}

pub fn sources() -> &'static Sources {
    static SOURCES: OnceLock<Sources> = OnceLock::new();
    SOURCES.get_or_init(|| {
        serde_json::from_str(embedded::SOURCES_JSON).expect("quickstart/sources.json is valid")
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Brand {
    pub name: String,
    pub repository: Option<Repository>,
    pub java: BrandJava,
}

#[derive(Debug, Deserialize)]
pub struct Repository {
    pub owner: String,
    pub name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrandJava {
    pub package: String,
    pub sim_package: String,
}

/// Reads `BRAND` from app/src/brand.ts, which must stay a JSON-compatible object (see scripts/brand.mjs).
pub fn parse_brand(source: &str) -> Result<Brand, String> {
    const START: &str = "export const BRAND = ";
    const END: &str = " as const;";
    let start = source.find(START).ok_or("brand.ts does not export BRAND")? + START.len();
    let length = source[start..]
        .find(END)
        .ok_or("BRAND must end with 'as const;'")?;
    serde_json::from_str(&source[start..start + length])
        .map_err(|error| format!("BRAND is not JSON-compatible: {error}"))
}

pub fn brand() -> &'static Brand {
    static BRAND: OnceLock<Brand> = OnceLock::new();
    BRAND.get_or_init(|| parse_brand(embedded::BRAND_TS).expect("app/src/brand.ts is valid"))
}

fn app_version() -> String {
    let package: serde_json::Value =
        serde_json::from_str(embedded::PACKAGE_JSON).expect("app/package.json is valid");
    package["version"]
        .as_str()
        .expect("app/package.json has a version")
        .to_owned()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RobotLibrary {
    /// From JitPack, for the public repository and this app's version.
    Release,
    /// Built from this repository's `robot/` folder (development builds only).
    Local,
}

pub fn default_robot_library(brand: &Brand) -> Result<RobotLibrary, String> {
    robot_library_for(brand, cfg!(debug_assertions))
}

/// Development builds always use the local `robot/` folder, so they work before a release is published.
fn robot_library_for(brand: &Brand, development: bool) -> Result<RobotLibrary, String> {
    if development {
        Ok(RobotLibrary::Local)
    } else if brand.repository.is_some() {
        Ok(RobotLibrary::Release)
    } else {
        Err(format!("This build of {} has no published robot library yet, so it cannot set up robot projects.", brand.name))
    }
}

pub fn tokens(
    brand: &Brand,
    sources: &Sources,
    library: RobotLibrary,
) -> Result<BTreeMap<String, String>, String> {
    let (coordinates, version) = match library {
        RobotLibrary::Local => (brand.java.package.clone(), "0.0.0-local".to_owned()),
        RobotLibrary::Release => {
            let repository = brand
                .repository
                .as_ref()
                .ok_or("Release projects need a public repository in brand.ts.")?;
            (
                format!("com.github.{}.{}", repository.owner, repository.name),
                format!("v{}", app_version()),
            )
        }
    };
    let mut tokens = sources.versions.clone();
    for (key, value) in [
        ("APP_NAME", brand.name.clone()),
        ("JAVA_PACKAGE", brand.java.package.clone()),
        ("SIM_PACKAGE", brand.java.sim_package.clone()),
        ("ROBOT_LIBRARY_COORDINATES", coordinates),
        ("ROBOT_LIBRARY_VERSION", version),
        (
            "PEDRO_QUICKSTART_COMMIT",
            sources.pedro_tuning_procedures.commit.clone(),
        ),
        ("FTC_SDK_TAG", sources.ftc_sdk.tag.clone()),
    ] {
        tokens.insert(key.to_owned(), value);
    }
    Ok(tokens)
}

/// Replaces `{{NAME}}` tokens (uppercase letters and underscores). Unknown tokens are errors.
pub fn substitute(text: &str, tokens: &BTreeMap<String, String>) -> Result<String, String> {
    let mut result = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(open) = rest.find("{{") {
        result.push_str(&rest[..open]);
        let after = &rest[open + 2..];
        let name_length = after
            .bytes()
            .take_while(|byte| byte.is_ascii_uppercase() || *byte == b'_')
            .count();
        if name_length > 0 && after[name_length..].starts_with("}}") {
            let name = &after[..name_length];
            let value = tokens
                .get(name)
                .ok_or_else(|| format!("Unknown template token {{{{{name}}}}}."))?;
            result.push_str(value);
            rest = &after[name_length + 2..];
        } else {
            result.push('{');
            rest = &rest[open + 1..];
        }
    }
    result.push_str(rest);
    Ok(result)
}

pub type Emit = Arc<dyn Fn(JobEvent<PathBuf>) + Send + Sync>;

/// Writes a new robot project into `destination`, which must be missing or empty. On failure or
/// cancellation everything written is removed again.
pub fn create(
    destination: &Path,
    library: RobotLibrary,
    cache: &Path,
    task: &TaskHandle,
    emit: &Emit,
) -> Result<PathBuf, String> {
    if !destination.is_absolute() {
        return Err("Choose a folder for the new project.".into());
    }
    let existed = destination.exists();
    if existed {
        let mut entries = fs::read_dir(destination)
            .map_err(|error| format!("{} is not a folder: {error}", destination.display()))?;
        if entries.next().is_some() {
            return Err(format!(
                "{} is not empty. Choose an empty or new folder.",
                destination.display()
            ));
        }
    }
    fs::create_dir_all(destination)
        .map_err(|error| format!("Could not create {}: {error}", destination.display()))?;
    let result = write_project(destination, library, cache, task, emit);
    if result.is_err() {
        // The folder was empty or missing before, so everything in it now was written here.
        if existed {
            if let Ok(entries) = fs::read_dir(destination) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    let _ = if path.is_dir() {
                        fs::remove_dir_all(&path)
                    } else {
                        fs::remove_file(&path)
                    };
                }
            }
        } else {
            let _ = fs::remove_dir_all(destination);
        }
    }
    result.map(|_| destination.to_path_buf())
}

fn write_project(
    destination: &Path,
    library: RobotLibrary,
    cache: &Path,
    task: &TaskHandle,
    emit: &Emit,
) -> Result<(), String> {
    let sources = sources();
    let tokens = tokens(brand(), sources, library)?;
    let progress = {
        let emit = emit.clone();
        move |received, total| emit(JobEvent::Progress { received, total })
    };

    emit(JobEvent::Step {
        message: format!("Downloading the FTC SDK {}", sources.ftc_sdk.tag),
    });
    let archive = download::fetch(
        &sources.ftc_sdk.url,
        &sources.ftc_sdk.sha256,
        cache,
        task,
        &progress,
    )?;
    emit(JobEvent::Step {
        message: "Extracting the FTC SDK".into(),
    });
    let prefix = &sources.ftc_sdk.strip_prefix;
    download::zip_entries(&archive, task, |name, reader, executable| {
        let path = name
            .strip_prefix(prefix.as_str())
            .ok_or_else(|| format!("Unexpected SDK archive layout: {name}"))?;
        // The SDK repository's contribution templates do not apply to a team project.
        if path.starts_with(".github/") {
            return Ok(());
        }
        let path = if path == "README.md" {
            "doc/FTC_SDK_README.md"
        } else {
            path
        };
        download::write_file(
            &download::safe_join(destination, path)?,
            reader,
            executable || path == "gradlew",
        )
    })?;

    emit(JobEvent::Step {
        message: "Downloading the Pedro Pathing tuning procedures".into(),
    });
    let procedures = &sources.pedro_tuning_procedures;
    for file in &procedures.files {
        let data = download::fetch(
            &format!("{}{}", procedures.base_url, file.path),
            &file.sha256,
            cache,
            task,
            &|_, _| {},
        )?;
        let target =
            download::safe_join(destination, file.target.as_deref().unwrap_or(&file.path))?;
        let mut reader = fs::File::open(&data).map_err(|error| error.to_string())?;
        download::write_file(&target, &mut reader, false)?;
    }

    emit(JobEvent::Step {
        message: "Adding Pedro Pathing, Panels, and the example programs".into(),
    });
    for (path, data) in embedded::OVERLAY {
        task.check()?;
        let is_text = Path::new(path)
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| TEXT_EXTENSIONS.contains(&extension));
        let bytes = if is_text {
            let text = std::str::from_utf8(data).map_err(|_| format!("{path} is not UTF-8"))?;
            substitute(text, &tokens)?.into_bytes()
        } else {
            data.to_vec()
        };
        download::write_file(
            &download::safe_join(destination, path)?,
            &mut bytes.as_slice(),
            false,
        )?;
    }

    append_line(
        &destination.join("TeamCode").join("build.gradle"),
        "apply from: 'libraries.gradle'",
        "// Pedro Pathing, Panels, and robot-library dependencies",
    )?;
    if library == RobotLibrary::Local {
        let settings = destination.join("settings.gradle");
        let text = read_text(&settings)?;
        let addition = format!("{}\n\n// Development only: use the robot library from a local checkout.\nincludeBuild('{}')\n", text.trim_end(), embedded::ROBOT_BUILD_DIR);
        fs::write(&settings, addition)
            .map_err(|error| format!("Could not update settings.gradle: {error}"))?;
    }
    Ok(())
}

fn read_text(path: &Path) -> Result<String, String> {
    let mut text = String::new();
    fs::File::open(path)
        .and_then(|mut file| file.read_to_string(&mut text))
        .map_err(|error| format!("Could not read {}: {error}", path.display()))?;
    Ok(text)
}

fn append_line(path: &Path, line: &str, comment: &str) -> Result<(), String> {
    let text = read_text(path)?;
    if !text.contains(line) {
        fs::write(path, format!("{}\n\n{comment}\n{line}\n", text.trim_end()))
            .map_err(|error| format!("Could not update {}: {error}", path.display()))?;
    }
    Ok(())
}

/// What `add_libraries` did with one file.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SdkChange {
    pub path: String,
    pub action: ChangeAction,
    pub note: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ChangeAction {
    Created,
    Updated,
    Kept,
}

const LIBRARIES_GRADLE: &str = "TeamCode/libraries.gradle";
const APPLY_LIBRARIES: &str = "apply from: 'libraries.gradle'";
const RUN_SIMULATOR: &str =
    "TeamCode/src/test/java/org/firstinspires/ftc/teamcode/simulation/RunSimulator.java";
const PEDRO_SETUP: &[&str] = &[
    "TeamCode/src/main/java/org/firstinspires/ftc/teamcode/pedro/Constants.java",
    "TeamCode/src/main/java/org/firstinspires/ftc/teamcode/pedro/Tuning.java",
];

/// An overlay file with its template tokens filled in.
fn overlay_file(path: &str, tokens: &BTreeMap<String, String>) -> Result<Vec<u8>, String> {
    let (_, data) = embedded::OVERLAY
        .iter()
        .find(|(overlay_path, _)| *overlay_path == path)
        .ok_or_else(|| format!("{path} is not part of the quickstart overlay."))?;
    let text = std::str::from_utf8(data).map_err(|_| format!("{path} is not UTF-8"))?;
    Ok(substitute(text, tokens)?.into_bytes())
}

/// True when a line (not a comment) applies libraries.gradle.
fn applies_libraries(build_gradle: &str) -> bool {
    build_gradle.lines().any(|line| {
        let line = line.trim_start();
        line.starts_with(APPLY_LIBRARIES) || line.starts_with("apply from: \"libraries.gradle\"")
    })
}

fn change(path: &str, action: ChangeAction, note: Option<&str>) -> SdkChange {
    SdkChange {
        path: path.to_owned(),
        action,
        note: note.map(str::to_owned),
    }
}

fn write_if_missing(root: &Path, path: &str, data: &[u8]) -> Result<SdkChange, String> {
    let target = download::safe_join(root, path)?;
    if target.exists() {
        return Ok(change(
            path,
            ChangeAction::Kept,
            Some("Already exists, so it was left as it is."),
        ));
    }
    download::write_file(&target, &mut &*data, false)?;
    Ok(change(path, ChangeAction::Created, None))
}

/// Adds what generated code needs to an existing FTC SDK project: the library dependencies, the
/// simulator entry point, and optionally the Pedro Pathing constants and AutoTune procedures. Files the
/// project already has are never replaced.
pub fn add_libraries(
    folder: &Path,
    library: RobotLibrary,
    include_pedro_setup: bool,
    cache: &Path,
    task: &TaskHandle,
    step: &dyn Fn(&str),
) -> Result<Vec<SdkChange>, String> {
    let build_gradle = folder.join("TeamCode").join("build.gradle");
    if !folder.is_absolute() || !build_gradle.is_file() {
        return Err(format!(
            "{} is not an FTC SDK project: TeamCode/build.gradle is missing.",
            folder.display()
        ));
    }
    let sources = sources();
    let tokens = tokens(brand(), sources, library)?;
    let mut changes = Vec::new();

    step("Adding Pedro Pathing, Ivy, Panels, and the robot library");
    let libraries = overlay_file(LIBRARIES_GRADLE, &tokens)?;
    let libraries_path = download::safe_join(folder, LIBRARIES_GRADLE)?;
    if libraries_path.exists() {
        let current = fs::read(&libraries_path)
            .map_err(|error| format!("Could not read {LIBRARIES_GRADLE}: {error}"))?;
        let same = String::from_utf8_lossy(&current).replace("\r\n", "\n")
            == String::from_utf8_lossy(&libraries);
        changes.push(change(
            LIBRARIES_GRADLE,
            ChangeAction::Kept,
            (!same).then_some("A different libraries.gradle already exists, so it was left as it is. Compare its dependencies with the ones this app needs."),
        ));
    } else {
        download::write_file(&libraries_path, &mut libraries.as_slice(), false)?;
        changes.push(change(LIBRARIES_GRADLE, ChangeAction::Created, None));
    }

    if applies_libraries(&read_text(&build_gradle)?) {
        changes.push(change("TeamCode/build.gradle", ChangeAction::Kept, None));
    } else {
        let text = read_text(&build_gradle)?;
        fs::write(
            &build_gradle,
            format!(
                "{}\n\n// Pedro Pathing, Panels, and robot-library dependencies\n{APPLY_LIBRARIES}\n",
                text.trim_end()
            ),
        )
        .map_err(|error| format!("Could not update TeamCode/build.gradle: {error}"))?;
        changes.push(change("TeamCode/build.gradle", ChangeAction::Updated, None));
    }

    if library == RobotLibrary::Local {
        let settings = folder.join("settings.gradle");
        let text = read_text(&settings)?;
        let include = format!("includeBuild('{}')", embedded::ROBOT_BUILD_DIR);
        if text.contains(&include) {
            changes.push(change("settings.gradle", ChangeAction::Kept, None));
        } else {
            fs::write(&settings, format!("{}\n\n// Development only: use the robot library from a local checkout.\n{include}\n", text.trim_end()))
                .map_err(|error| format!("Could not update settings.gradle: {error}"))?;
            changes.push(change("settings.gradle", ChangeAction::Updated, None));
        }
    }

    changes.push(write_if_missing(
        folder,
        RUN_SIMULATOR,
        &overlay_file(RUN_SIMULATOR, &tokens)?,
    )?);

    if include_pedro_setup {
        for path in PEDRO_SETUP {
            task.check()?;
            changes.push(write_if_missing(
                folder,
                path,
                &overlay_file(path, &tokens)?,
            )?);
        }
        step("Downloading the Pedro Pathing tuning procedures");
        let procedures = &sources.pedro_tuning_procedures;
        for file in &procedures.files {
            task.check()?;
            let path = file.target.as_deref().unwrap_or(&file.path);
            if download::safe_join(folder, path)?.exists() {
                changes.push(change(
                    path,
                    ChangeAction::Kept,
                    Some("Already exists, so it was left as it is."),
                ));
                continue;
            }
            let data = download::fetch(
                &format!("{}{}", procedures.base_url, file.path),
                &file.sha256,
                cache,
                task,
                &|_, _| {},
            )?;
            let bytes = fs::read(&data).map_err(|error| error.to_string())?;
            changes.push(write_if_missing(folder, path, &bytes)?);
        }
    }
    Ok(changes)
}

/// Starts adding the libraries generated code needs to an existing FTC SDK project, and returns a task
/// id for `cancel`. The list of changes arrives with the `done` event.
#[tauri::command(async)]
pub fn sdk_add_libraries<R: Runtime>(
    app: AppHandle<R>,
    tasks: State<'_, Tasks>,
    folder: PathBuf,
    include_pedro_setup: bool,
    on_event: Channel<JobEvent<Vec<SdkChange>>>,
) -> Result<u32, String> {
    let library = default_robot_library(brand())?;
    let dirs = Dirs::of(&app)?;
    let (id, task) = tasks.start();
    thread::spawn(move || {
        let events = on_event.clone();
        let step = move |message: &str| {
            let _ = events.send(JobEvent::Step {
                message: message.to_owned(),
            });
        };
        let event = match add_libraries(
            &folder,
            library,
            include_pedro_setup,
            &dirs.cache,
            &task,
            &step,
        ) {
            Ok(changes) => JobEvent::Done { result: changes },
            Err(message) => JobEvent::Failed {
                cancelled: task.is_cancelled(),
                message,
            },
        };
        let _ = on_event.send(event);
        app.state::<Tasks>().finish(id);
    });
    Ok(id)
}

/// Starts creating a project and returns a task id for `cancel`. The finished folder is added to the
/// app's file access so the editor can open it.
#[tauri::command(async)]
pub fn quickstart_create<R: Runtime>(
    app: AppHandle<R>,
    tasks: State<'_, Tasks>,
    destination: PathBuf,
    on_event: Channel<JobEvent<PathBuf>>,
) -> Result<u32, String> {
    let library = default_robot_library(brand())?;
    let dirs = Dirs::of(&app)?;
    let (id, task) = tasks.start();
    thread::spawn(move || {
        let emit: Emit = Arc::new(move |event| {
            let _ = on_event.send(event);
        });
        let result = create(&destination, library, &dirs.cache, &task, &emit).and_then(|path| {
            app.fs_scope()
                .allow_directory(&path, true)
                .map(|_| path)
                .map_err(|error| error.to_string())
        });
        match result {
            Ok(path) => emit(JobEvent::Done { result: path }),
            Err(message) => emit(JobEvent::Failed {
                cancelled: task.is_cancelled(),
                message,
            }),
        }
        app.state::<Tasks>().finish(id);
    });
    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn quiet() -> Emit {
        Arc::new(|_| {})
    }

    #[test]
    fn reads_the_brand_and_sources() {
        let brand = brand();
        assert!(!brand.name.is_empty());
        assert!(brand.java.package.contains('.'));
        assert_eq!(sources().ftc_sdk.sha256.len(), 64);
        assert!(parse_brand("export const BRAND = { \"name\": 1 } as const;").is_err());
        assert!(parse_brand("const nothing = 1;").is_err());
    }

    #[test]
    fn substitutes_tokens_like_the_script() {
        let tokens = BTreeMap::from([("A_B".to_owned(), "x".to_owned())]);
        assert_eq!(
            substitute("{{A_B}} {{{A_B}}} {{a}} {{ A_B }} {{", &tokens).unwrap(),
            "x {x} {{a}} {{ A_B }} {{"
        );
        assert!(substitute("{{MISSING}}", &tokens)
            .unwrap_err()
            .contains("{{MISSING}}"));
    }

    #[test]
    fn development_builds_use_the_local_robot_library() {
        let mut brand = parse_brand(embedded::BRAND_TS).unwrap();
        assert!(brand.repository.is_some());
        assert_eq!(robot_library_for(&brand, true), Ok(RobotLibrary::Local));
        assert_eq!(robot_library_for(&brand, false), Ok(RobotLibrary::Release));
        brand.repository = None;
        assert_eq!(robot_library_for(&brand, true), Ok(RobotLibrary::Local));
        assert!(robot_library_for(&brand, false)
            .unwrap_err()
            .contains("no published robot library"));
    }

    #[test]
    fn every_overlay_token_is_known() {
        let brand = Brand {
            name: "Test".into(),
            repository: Some(Repository {
                owner: "owner".into(),
                name: "repo".into(),
            }),
            java: BrandJava {
                package: "dev.test.ftc".into(),
                sim_package: "dev.test.sim".into(),
            },
        };
        for library in [RobotLibrary::Local, RobotLibrary::Release] {
            let tokens = tokens(&brand, sources(), library).unwrap();
            for (path, data) in embedded::OVERLAY {
                if let Ok(text) = std::str::from_utf8(data) {
                    substitute(text, &tokens).unwrap_or_else(|error| panic!("{path}: {error}"));
                }
            }
        }
        let release = tokens(&brand, sources(), RobotLibrary::Release).unwrap();
        assert_eq!(
            release["ROBOT_LIBRARY_COORDINATES"],
            "com.github.owner.repo"
        );
        assert!(release["ROBOT_LIBRARY_VERSION"].starts_with('v'));
        assert!(embedded::OVERLAY.iter().any(|(path, _)| *path
            == "TeamCode/src/main/java/org/firstinspires/ftc/teamcode/pedro/Constants.java"));
    }

    #[test]
    fn refuses_non_empty_or_relative_destinations() {
        let temp = tempfile::tempdir().unwrap();
        fs::write(temp.path().join("keep.txt"), "mine").unwrap();
        let (_, task) = Tasks::default().start();
        let error = create(
            temp.path(),
            RobotLibrary::Local,
            temp.path(),
            &task,
            &quiet(),
        )
        .unwrap_err();
        assert!(error.contains("not empty"));
        assert_eq!(
            fs::read_to_string(temp.path().join("keep.txt")).unwrap(),
            "mine"
        );
        assert!(create(
            Path::new("relative"),
            RobotLibrary::Local,
            temp.path(),
            &task,
            &quiet()
        )
        .is_err());
    }

    #[test]
    fn removes_partial_output_when_cancelled() {
        let temp = tempfile::tempdir().unwrap();
        let tasks = Tasks::default();
        let (id, task) = tasks.start();
        tasks.cancel(id);
        let destination = temp.path().join("robot");
        let error = create(
            &destination,
            RobotLibrary::Local,
            &temp.path().join("cache"),
            &task,
            &quiet(),
        )
        .unwrap_err();
        assert_eq!(error, crate::tasks::CANCELLED);
        assert!(!destination.exists());

        let empty = temp.path().join("empty");
        fs::create_dir(&empty).unwrap();
        assert!(create(
            &empty,
            RobotLibrary::Local,
            &temp.path().join("cache"),
            &task,
            &quiet()
        )
        .is_err());
        assert!(empty.is_dir() && fs::read_dir(&empty).unwrap().next().is_none());
    }

    /// The build files of a plain FTC SDK project, written from scratch for the tests.
    fn plain_sdk() -> tempfile::TempDir {
        let temp = tempfile::tempdir().unwrap();
        fs::create_dir_all(temp.path().join("TeamCode")).unwrap();
        fs::write(
            temp.path().join("settings.gradle"),
            "include ':FtcRobotController'\ninclude ':TeamCode'\n",
        )
        .unwrap();
        fs::write(
            temp.path().join("TeamCode/build.gradle"),
            "apply plugin: 'com.android.application'\napply from: '../build.dependencies.gradle'\n",
        )
        .unwrap();
        temp
    }

    fn actions(changes: &[SdkChange]) -> Vec<(String, ChangeAction)> {
        changes
            .iter()
            .map(|change| (change.path.clone(), change.action))
            .collect()
    }

    #[test]
    fn adds_libraries_to_a_plain_sdk_once() {
        let sdk = plain_sdk();
        let (_, task) = Tasks::default().start();
        let changes = add_libraries(
            sdk.path(),
            RobotLibrary::Local,
            false,
            sdk.path(),
            &task,
            &|_| {},
        )
        .unwrap();
        assert_eq!(
            actions(&changes),
            [
                (LIBRARIES_GRADLE.to_owned(), ChangeAction::Created),
                ("TeamCode/build.gradle".to_owned(), ChangeAction::Updated),
                ("settings.gradle".to_owned(), ChangeAction::Updated),
                (RUN_SIMULATOR.to_owned(), ChangeAction::Created),
            ]
        );
        let libraries = fs::read_to_string(sdk.path().join(LIBRARIES_GRADLE)).unwrap();
        assert!(!libraries.contains("{{"));
        assert!(libraries.contains("com.pedropathing.ivy:pedro:"));
        let build = fs::read_to_string(sdk.path().join("TeamCode/build.gradle")).unwrap();
        assert!(applies_libraries(&build));
        assert!(fs::read_to_string(sdk.path().join("settings.gradle"))
            .unwrap()
            .contains("includeBuild("));

        let again = add_libraries(
            sdk.path(),
            RobotLibrary::Local,
            false,
            sdk.path(),
            &task,
            &|_| {},
        )
        .unwrap();
        assert!(again
            .iter()
            .all(
                |change| change.action == ChangeAction::Kept && change.note.is_none()
                    || change.path == RUN_SIMULATOR
            ));
        assert_eq!(
            fs::read_to_string(sdk.path().join("TeamCode/build.gradle")).unwrap(),
            build
        );
    }

    #[test]
    fn never_replaces_the_teams_files() {
        let sdk = plain_sdk();
        let (_, task) = Tasks::default().start();
        fs::write(sdk.path().join(LIBRARIES_GRADLE), "// ours\n").unwrap();
        // A commented-out apply line does not count.
        fs::write(
            sdk.path().join("TeamCode/build.gradle"),
            "// apply from: 'libraries.gradle'\n",
        )
        .unwrap();
        let constants = download::safe_join(sdk.path(), PEDRO_SETUP[0]).unwrap();
        fs::create_dir_all(constants.parent().unwrap()).unwrap();
        fs::write(&constants, "class Mine {}\n").unwrap();
        // Existing procedure files mean nothing needs to be downloaded.
        for file in &sources().pedro_tuning_procedures.files {
            let path =
                download::safe_join(sdk.path(), file.target.as_deref().unwrap_or(&file.path))
                    .unwrap();
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, "existing").unwrap();
        }

        let changes = add_libraries(
            sdk.path(),
            RobotLibrary::Local,
            true,
            sdk.path(),
            &task,
            &|_| {},
        )
        .unwrap();
        let find = |path: &str| changes.iter().find(|change| change.path == path).unwrap();
        assert_eq!(find(LIBRARIES_GRADLE).action, ChangeAction::Kept);
        assert!(find(LIBRARIES_GRADLE).note.is_some());
        assert_eq!(
            fs::read_to_string(sdk.path().join(LIBRARIES_GRADLE)).unwrap(),
            "// ours\n"
        );
        assert_eq!(find("TeamCode/build.gradle").action, ChangeAction::Updated);
        assert_eq!(find(PEDRO_SETUP[0]).action, ChangeAction::Kept);
        assert_eq!(fs::read_to_string(&constants).unwrap(), "class Mine {}\n");
        assert_eq!(find(PEDRO_SETUP[1]).action, ChangeAction::Created);
        assert!(changes
            .iter()
            .filter(|change| change.path.contains("/procedures/"))
            .all(|change| change.action == ChangeAction::Kept));
    }

    #[test]
    fn refuses_folders_that_are_not_ftc_projects() {
        let temp = tempfile::tempdir().unwrap();
        let (_, task) = Tasks::default().start();
        let error = add_libraries(
            temp.path(),
            RobotLibrary::Local,
            false,
            temp.path(),
            &task,
            &|_| {},
        )
        .unwrap_err();
        assert!(error.contains("TeamCode/build.gradle"));
    }

    /// Creates a project with the Rust code and with scripts/quickstart.mjs and compares every file.
    /// Run with `cargo test matches_the_node_script -- --ignored` (needs Node.js and internet access).
    #[test]
    #[ignore = "downloads the FTC SDK and needs Node.js"]
    fn matches_the_node_script() {
        let temp = tempfile::tempdir().unwrap();
        let cache = temp.path().join("cache");
        let (_, task) = Tasks::default().start();
        let rust = temp.path().join("rust");
        create(&rust, RobotLibrary::Local, &cache, &task, &quiet())
            .unwrap_or_else(|error| panic!("{error}"));

        let node = temp.path().join("node");
        let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../scripts/quickstart.mjs");
        let status = std::process::Command::new("node")
            .arg(script)
            .args([
                "--out".as_ref(),
                node.as_os_str(),
                "--robot-library".as_ref(),
                "local".as_ref(),
                "--cache".as_ref(),
                temp.path().join("node-cache").as_os_str(),
            ])
            .status()
            .unwrap();
        assert!(status.success());

        fn files(root: &Path, directory: &Path, out: &mut BTreeMap<String, Vec<u8>>) {
            for entry in fs::read_dir(directory).unwrap().flatten() {
                let path = entry.path();
                if path.is_dir() {
                    files(root, &path, out);
                } else {
                    out.insert(
                        path.strip_prefix(root)
                            .unwrap()
                            .to_string_lossy()
                            .replace('\\', "/"),
                        fs::read(&path).unwrap(),
                    );
                }
            }
        }
        let (mut from_rust, mut from_node) = (BTreeMap::new(), BTreeMap::new());
        files(&rust, &rust, &mut from_rust);
        files(&node, &node, &mut from_node);
        assert_eq!(
            from_rust.keys().collect::<Vec<_>>(),
            from_node.keys().collect::<Vec<_>>()
        );
        for (path, data) in &from_rust {
            assert!(data == &from_node[path], "{path} differs");
        }
        println!("{} files match", from_rust.len());
    }
}
