import { describe, expect, it } from "vitest";
import dependencyFailure from "../../../../fixtures/build-output/dependency-failure.json";
import semanticErrors from "../../../../fixtures/build-output/semantic-errors.json";
import success from "../../../../fixtures/build-output/success.json";
import syntaxError from "../../../../fixtures/build-output/syntax-error.json";
import { parseBuildOutput, relativeToProject } from "./buildOutput";

// Real Gradle 9.1 output lines from a generated robot project, with the project folder renamed to C:\robot.
const AUTO = "TeamCode/src/main/java/org/firstinspires/ftc/teamcode/examples/ExampleAuto.java";

describe("parseBuildOutput", () => {
  it("reads javac errors with columns and details, once each", () => {
    const summary = parseBuildOutput(semanticErrors, "C:\\robot");
    expect(summary.outcome).toBe("failure");
    expect(summary.failure).toBeUndefined();
    expect(summary.problems).toEqual([
      {
        severity: "error",
        message: "cannot find symbol",
        file: AUTO,
        line: 77,
        column: 17,
        details: ["symbol:   method updat()", "location: variable follower of type Follower"],
      },
      {
        severity: "error",
        message: "incompatible types: String cannot be converted to int",
        file: AUTO,
        line: 78,
        column: 21,
        details: [],
      },
    ]);
  });

  it("reads syntax errors", () => {
    const summary = parseBuildOutput(syntaxError, "c:/ROBOT/");
    expect(summary.problems).toEqual([{ severity: "error", message: "';' expected", file: AUTO, line: 77, column: 26, details: [] }]);
  });

  it("explains failures that are not compile errors", () => {
    const summary = parseBuildOutput(dependencyFailure, "C:\\robot");
    expect(summary.outcome).toBe("failure");
    expect(summary.problems).toEqual([]);
    expect(summary.failure).toContain("Could not find com.bylazar:fullpanels-missing:1.0.12.");
    expect(summary.failure).not.toContain("--stacktrace");
  });

  it("reports success without problems", () => {
    expect(parseBuildOutput(success, "C:\\robot")).toEqual({ outcome: "success", problems: [] });
    expect(parseBuildOutput([]).outcome).toBe("unknown");
  });

  it("reads warnings and Unix paths", () => {
    const summary = parseBuildOutput(
      [
        "/home/team/robot/TeamCode/src/main/java/Foo.java:3: warning: [deprecation] Bar in Baz has been deprecated",
        "import com.example.Baz.Bar;",
        "                      ^",
        "BUILD SUCCESSFUL in 4s",
      ],
      "/home/team/robot",
    );
    expect(summary).toEqual({
      outcome: "success",
      problems: [
        {
          severity: "warning",
          message: "[deprecation] Bar in Baz has been deprecated",
          file: "TeamCode/src/main/java/Foo.java",
          line: 3,
          column: 23,
          details: [],
        },
      ],
    });
  });

  it("keeps paths outside the project absolute", () => {
    expect(relativeToProject("D:\\other\\A.java", "C:\\robot")).toBe("D:/other/A.java");
    expect(relativeToProject("/home/a/B.java", "/home/team")).toBe("/home/a/B.java");
    expect(relativeToProject("C:\\robot\\A.java")).toBe("C:/robot/A.java");
  });
});
