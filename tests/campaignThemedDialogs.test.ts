import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";

const PLAYBOOK_DIR = path.resolve(__dirname, "..", "src", "features", "playbook");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const fullPath = path.join(dir, name);
    return statSync(fullPath).isDirectory()
      ? sourceFiles(fullPath)
      : /\.(ts|tsx)$/.test(name)
        ? [fullPath]
        : [];
  });
}

describe("Campaigns themed interaction surfaces", () => {
  it("does not use browser-native alert, confirm, or prompt dialogs", () => {
    const nativeDialogCall = /\b(?:window\.)?(?:alert|confirm|prompt)\s*\(/;
    const offenders = sourceFiles(PLAYBOOK_DIR)
      .filter((file) => nativeDialogCall.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(PLAYBOOK_DIR, file));

    expect(offenders).toEqual([]);
  });
});
