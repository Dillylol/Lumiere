import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { brandChanges, readBrand, root, writeChanges } from "./brand.mjs";
import { javaPackageChanges, renameChanges } from "./rename.mjs";

const files = ["app/src/brand.ts", "app/src-tauri/tauri.conf.json", "app/src-tauri/Cargo.toml", "app/package.json", "app/package-lock.json", "app/index.html", "LICENSE", "README.md"];
test("rename previews every file without writes, applies coherently, and preserves saved-project identity", () => {
  const directory = mkdtempSync(join(tmpdir(), "ftc-brand-"));
  try {
    for (const file of files) {
      mkdirSync(dirname(join(directory, file)), { recursive: true });
      copyFileSync(join(root, file), join(directory, file));
    }
    writeFileSync(join(directory, "LICENSE"), "Copyright (c) 2026, The Old Name Contributors\n");
    const old = readBrand(directory);
    const upgradeCode = () => JSON.parse(readFileSync(join(directory, "app/src-tauri/tauri.conf.json"), "utf8")).bundle.windows.wix.upgradeCode;
    const oldUpgradeCode = upgradeCode();
    const before = files.map((file) => readFileSync(join(directory, file), "utf8"));
    const changes = renameChanges("Test Name", directory);
    assert.deepEqual(files.map((file) => readFileSync(join(directory, file), "utf8")), before);
    writeChanges(changes, directory);
    assert.equal(brandChanges(directory).size, 0);
    assert.equal(renameChanges("Test Name", directory).size, 0);
    const brand = readBrand(directory);
    assert.equal(brand.name, "Test Name");
    assert.equal(brand.java.classPrefix, "TestName");
    for (const key of ["identifier", "storageNamespace", "projectExtension"]) assert.equal(brand[key], old[key]);
    assert.equal(upgradeCode(), oldUpgradeCode, "Windows keeps upgrading the same installed app");
    assert.match(readFileSync(join(directory, "LICENSE"), "utf8"), /The Test Name Contributors/);
    assert.equal(JSON.parse(readFileSync(join(directory, "app/package-lock.json"))).packages[""].name, "test-name");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("rename leaves a license with a named copyright holder alone", () => {
  const directory = mkdtempSync(join(tmpdir(), "ftc-brand-license-"));
  try {
    for (const file of files) {
      mkdirSync(dirname(join(directory, file)), { recursive: true });
      copyFileSync(join(root, file), join(directory, file));
    }
    writeFileSync(join(directory, "LICENSE"), "Copyright (c) 2026, Jane Doe\n");
    writeChanges(renameChanges("Test Name", directory), directory);
    assert.equal(readFileSync(join(directory, "LICENSE"), "utf8"), "Copyright (c) 2026, Jane Doe\n");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("rename rejects code and path injection before reading or writing project files", () => {
  for (const name of ["../escape", "Bad\nName", "<script>", "Bad\"Name", " Name", "", "日本", "Café;rm"]) {
    assert.throws(() => renameChanges(name, "missing-directory"), /Use 1–48/);
  }
});

test("rename keeps accents in the display name and uses an ASCII spelling for identifiers", () => {
  const directory = mkdtempSync(join(tmpdir(), "ftc-brand-accent-"));
  try {
    for (const file of files) {
      mkdirSync(dirname(join(directory, file)), { recursive: true });
      copyFileSync(join(root, file), join(directory, file));
    }
    // A decomposed è, as some keyboards and terminals produce it.
    writeChanges(renameChanges("Lumie\u0300re Robotics", directory), directory);
    const brand = readBrand(directory);
    assert.equal(brand.name, "Lumière Robotics");
    assert.equal(brand.slug, "lumiere-robotics");
    assert.equal(brand.java.package, "dev.lumiererobotics.ftc");
    assert.equal(brand.java.classPrefix, "LumiereRobotics");
    const tauri = JSON.parse(readFileSync(join(directory, "app/src-tauri/tauri.conf.json"), "utf8"));
    assert.equal(tauri.productName, "Lumière Robotics");
    assert.equal(tauri.mainBinaryName, "lumiere-robotics");
    assert.equal(tauri.bundle.createUpdaterArtifacts, true);
    assert.equal(tauri.plugins.updater.pubkey, brand.updaterPublicKey);
    assert.equal(tauri.plugins.updater.endpoints[0], "https://github.com/Dillylol/Lumiere/releases/latest/download/latest.json");
    assert.match(readFileSync(join(directory, "app/index.html"), "utf8"), /<title>Lumière Robotics · /);
    assert.equal(brandChanges(directory).size, 0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("rename moves robot library and simulator packages and rewrites their references", () => {
  const directory = mkdtempSync(join(tmpdir(), "ftc-rename-java-"));
  const write = (file, text) => { mkdirSync(dirname(join(directory, file)), { recursive: true }); writeFileSync(join(directory, file), text); };
  try {
    for (const file of files) {
      mkdirSync(dirname(join(directory, file)), { recursive: true });
      copyFileSync(join(root, file), join(directory, file));
    }
    const { java } = readBrand(directory);
    const folder = (name) => name.replaceAll(".", "/");
    const lines = (...parts) => parts.map((part) => `${part}${String.fromCharCode(10)}`).join("");
    write(`robot/ftc-lib/src/main/java/${folder(java.package)}/Session.java`, lines(`package ${java.package};`, `import ${java.package}.internal.Json;`));
    write(`robot/sim/src/main/java/${folder(java.simPackage)}/hardware/SimHardware.java`, lines(`package ${java.simPackage}.hardware;`));
    write("robot/gradle.properties", lines(`group=${java.package}`));
    write(`robot/ftc-lib/build/intermediates/${folder(java.package)}/Stale.java`, lines(`package ${java.package};`));
    write("fixtures/golden-tests/SimTest.java", lines(`import ${java.simPackage}.HeadlessRun;`));

    const changes = renameChanges("Test Name", directory);
    assert.equal(changes.get(`robot/ftc-lib/src/main/java/${folder(java.package)}/Session.java`), null);
    assert.ok(!existsSync(join(directory, "robot/ftc-lib/src/main/java/dev/testname")), "dry run writes nothing");
    writeChanges(changes, directory);

    const read = (file) => readFileSync(join(directory, file), "utf8");
    assert.equal(read("robot/ftc-lib/src/main/java/dev/testname/ftc/Session.java"), lines("package dev.testname.ftc;", "import dev.testname.ftc.internal.Json;"));
    assert.equal(read("robot/sim/src/main/java/dev/testname/sim/hardware/SimHardware.java"), lines("package dev.testname.sim.hardware;"));
    assert.equal(read("robot/gradle.properties"), lines("group=dev.testname.ftc"));
    assert.equal(read("fixtures/golden-tests/SimTest.java"), lines("import dev.testname.sim.HeadlessRun;"));
    const [company, product] = java.package.split(".");
    assert.ok(!existsSync(join(directory, "robot/ftc-lib/src/main/java", company, product)), "old package folders are removed");
    assert.ok(existsSync(join(directory, `robot/ftc-lib/build/intermediates/${folder(java.package)}/Stale.java`)), "build output is left alone");
    assert.equal(renameChanges("Test Name", directory).size, 0);
    assert.equal(javaPackageChanges(directory, readBrand(directory).java, readBrand(directory).java).size, 0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
