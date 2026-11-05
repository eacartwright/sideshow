import { describe, expect, it } from "vitest";
import { parseNote, serializeNote, withoutPictures } from "./markdown";

const round = (md: string) => serializeNote(parseNote(md));

describe("notes as Markdown", () => {
  it("keeps plain notes from before the editor exactly as they were", () => {
    for (const note of [
      "rebooted FW",
      "rebooted FW\nfirmware 7.2.3\ncalled ISP",
      "- rebooted FW\n- firmware 7.2.3",
      "Called Dr. Spitz (front desk) about the scanner",
      "Line one\n\nLine after a blank line",
    ]) {
      expect(round(note)).toBe(note);
    }
  });

  it("round-trips CW's formatting", () => {
    expect(round("**Action Taken:**\n- Signed in\n- Modified the settings")).toBe("**Action Taken:**\n\n- Signed in\n- Modified the settings");
    expect(round("*Sales Administrator*")).toBe("*Sales Administrator*");
    expect(round("1. Review both tickets\n2. Remote control Op6")).toBe("1. Review both tickets\n2. Remote control Op6");
    expect(round("[View your quote](https://example.com/q?a=1)")).toBe("[View your quote](https://example.com/q?a=1)");
    expect(round("![screenshot.png](/api/files/abc/screenshot.png)")).toBe("![screenshot.png](/api/files/abc/screenshot.png)");
  });

  it("gives an empty note one empty line, which saves as empty", () => {
    for (const note of ["", "   ", "\n\n"]) {
      expect(parseNote(note)).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
      expect(round(note)).toBe("");
    }
  });

  it("turns outside pictures into links", () => {
    expect(withoutPictures("before ![a.png](https://x.example/a.png) after")).toBe("before [Picture: a.png](https://x.example/a.png) after");
    expect(withoutPictures('![](https://x.example/b.png "title")')).toBe("[Picture](https://x.example/b.png)");
    expect(JSON.stringify(parseNote(withoutPictures("![a](https://x.example/a.png)")))).not.toContain('"image"');
  });

  it("writes underline as ++text++", () => {
    expect(round("a ++b++ c")).toBe("a ++b++ c");
  });
});
