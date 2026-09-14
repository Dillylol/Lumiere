import { describe, expect, it } from "vitest";
import casesFile from "../../../../fixtures/parity/cases.json";
import expectedFile from "../../../../fixtures/parity/expected.json";
import type { PathDoc, Point } from "../ir/types";
import { angleError } from "./curves";
import { resolvePath } from "./paths";

interface RawPath {
  kind: "atomic" | "compound";
  segments?: RawPath[];
  [key: string]: unknown;
}

interface Case {
  name: string;
  start: Point;
  path: RawPath;
}

const cases = (casesFile as unknown as { cases: Case[] }).cases;
const expected = (expectedFile as unknown as {
  cases: { name: string; length: number; samples: [number, number, number, number, number][] }[];
}).cases;

function withIds(path: RawPath): PathDoc {
  if (path.kind === "compound") {
    return {
      ...path,
      id: "p",
      name: "",
      color: "#000",
      segments: (path.segments ?? []).map((segment, index) => ({ ...segment, id: `s${index}`, name: "", color: "#000" })),
    } as unknown as PathDoc;
  }
  return { ...path, id: "p", name: "", color: "#000" } as unknown as PathDoc;
}

describe("geometry matches Pedro Pathing and the robot library's Headings", () => {
  it("has expected values for every case", () => {
    expect(expected.map((entry) => entry.name)).toEqual(cases.map((entry) => entry.name));
  });

  cases.forEach((testCase, index) => {
    it(testCase.name, () => {
      const resolved = resolvePath(withIds(testCase.path), testCase.start);
      const want = expected[index];
      expect(resolved.curve.length).toBeCloseTo(want.length, 6);
      for (const [t, x, y, heading, remaining] of want.samples) {
        const pose = resolved.poseAt(t);
        expect(pose.x, `x at t=${t}`).toBeCloseTo(x, 6);
        expect(pose.y, `y at t=${t}`).toBeCloseTo(y, 6);
        expect(Math.abs(angleError(pose.heading, heading)), `heading at t=${t}`).toBeLessThan(1e-6);
        expect(resolved.curve.remainingDistance(t), `remaining at t=${t}`).toBeCloseTo(remaining, 6);
      }
    });
  });
});
