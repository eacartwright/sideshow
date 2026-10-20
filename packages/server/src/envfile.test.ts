import { describe, expect, it } from "vitest";
import { envSafe, withValues } from "./envfile";

describe(".env updates", () => {
  it("replaces a key's line where it is and keeps everything else", () => {
    const text = "# CW\nCW_SITE=old.example\nPORT=8081\n# member\nCW_MEMBER=\nPROFILE=veritaz-cw\n";
    expect(withValues(text, { CW_SITE: "api-na.myconnectwise.net", CW_MEMBER: "ecartwright" })).toBe(
      "# CW\nCW_SITE=api-na.myconnectwise.net\nPORT=8081\n# member\nCW_MEMBER=ecartwright\nPROFILE=veritaz-cw\n",
    );
  });

  it("adds missing keys at the end, keeping Windows line endings", () => {
    expect(withValues("PORT=8081\r\nSIDESHOW_BACKUP_DIR=\\\\nas\\x\r\n", { CW_SITE: "s" })).toBe(
      "PORT=8081\r\nSIDESHOW_BACKUP_DIR=\\\\nas\\x\r\nCW_SITE=s\r\n",
    );
    expect(withValues("", { CW_SITE: "s" })).toBe("CW_SITE=s\n");
    expect(withValues("PORT=1", { CW_SITE: "s" })).toBe("PORT=1\nCW_SITE=s\n");
  });

  it("leaves commented-out lines alone", () => {
    expect(withValues("# CW_SITE=example\n", { CW_SITE: "s" })).toBe("# CW_SITE=example\nCW_SITE=s\n");
  });

  it("only takes values that fit on one plain line", () => {
    expect(envSafe("api-na.myconnectwise.net")).toBe(true);
    expect(envSafe("")).toBe(true);
    expect(envSafe("a\nPORT=1")).toBe(false);
    expect(envSafe("a # b")).toBe(false);
    expect(envSafe(' "x"')).toBe(false);
  });
});
