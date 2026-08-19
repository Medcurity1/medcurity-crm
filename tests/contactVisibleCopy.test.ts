import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const read = (relative: string) =>
  readFileSync(path.resolve(__dirname, "..", relative), "utf8");

function visibleSource(relative: string): string {
  return read(relative)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("Contacts visible copy", () => {
  it("does not use em or en dashes in the cleaned Contacts surfaces", () => {
    const source = [
      "src/features/contacts/ContactDetail.tsx",
      "src/features/contacts/ContactForm.tsx",
      "src/features/contacts/import/ContactImportWizard.tsx",
    ]
      .map(visibleSource)
      .join("\n");

    expect(source).not.toMatch(/[—–]/);
  });
});
