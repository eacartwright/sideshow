import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { profileProblems, type Profile } from "@sideshow/shared";

const dir = new URL("../profiles/", import.meta.url);

describe("profileProblems", () => {
  it("passes every profile in the repo", () => {
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      const p = JSON.parse(readFileSync(new URL(file, dir), "utf8")) as Profile;
      expect(profileProblems(p), file).toEqual([]);
    }
  });

  it("checks segmented inputs and short labels", () => {
    const p: Profile = {
      name: "t",
      fields: [
        { key: "a", label: "A", on: "session", type: "choice", options: ["X", "Y"], input: "segmented", short: ["x"] },
        { key: "b", label: "B", on: "session", type: "text", input: "segmented" },
      ],
    };
    expect(profileProblems(p)).toEqual([
      'field "a": "short" needs one label per option',
      'field "b": "input": "segmented" is for choice fields',
    ]);
  });
});
