import { describe, it, expect } from "vitest";
import { splitFullName, guessField, rowsToRecipients, type RecipientField } from "@/features/playbook/csv";

// ---------------------------------------------------------------------------
// Campaigns CSV import — the "Name" column split (docket E1). A single
// full-name column used to land wholesale in first_name, so campaign emails
// greeted "Hi Jane Smith,". These tests pin the split's contract, including
// the messy real-world shapes: honorifics, healthcare credentials,
// "Last, First" exports, middle initials, and compound names on both sides.
// ---------------------------------------------------------------------------

describe("splitFullName", () => {
  it("splits the plain two-word case", () => {
    expect(splitFullName("Jane Smith")).toEqual({ first_name: "Jane", last_name: "Smith" });
  });

  it("keeps a single word as first name only", () => {
    expect(splitFullName("Cher")).toEqual({ first_name: "Cher" });
  });

  it("strips honorifics", () => {
    expect(splitFullName("Dr. Jane Doe")).toEqual({ first_name: "Jane", last_name: "Doe" });
    expect(splitFullName("Mr John Smith")).toEqual({ first_name: "John", last_name: "Smith" });
    expect(splitFullName("Prof. Dr. Anna Klein")).toEqual({ first_name: "Anna", last_name: "Klein" });
  });

  it("strips comma-separated credentials", () => {
    expect(splitFullName("Jane Doe, MD")).toEqual({ first_name: "Jane", last_name: "Doe" });
    expect(splitFullName("Jane Doe, MD, PhD")).toEqual({ first_name: "Jane", last_name: "Doe" });
    expect(splitFullName("Sara Jones, RN, BSN")).toEqual({ first_name: "Sara", last_name: "Jones" });
  });

  it("strips trailing credentials and generational suffixes without commas", () => {
    expect(splitFullName("Jane Doe MD")).toEqual({ first_name: "Jane", last_name: "Doe" });
    expect(splitFullName("John Smith Jr.")).toEqual({ first_name: "John", last_name: "Smith" });
    expect(splitFullName("John Smith III")).toEqual({ first_name: "John", last_name: "Smith" });
  });

  it("reorders exported Last, First format", () => {
    expect(splitFullName("Smith, Jane")).toEqual({ first_name: "Jane", last_name: "Smith" });
    expect(splitFullName("Smith, Jane, MD")).toEqual({ first_name: "Jane", last_name: "Smith" });
    expect(splitFullName("van der Berg, Anna")).toEqual({ first_name: "Anna", last_name: "van der Berg" });
  });

  it("keeps compound surnames whole via particles — which also preserves multi-word first names", () => {
    expect(splitFullName("Jane van der Berg")).toEqual({ first_name: "Jane", last_name: "van der Berg" });
    expect(splitFullName("Anna Maria van Dijk")).toEqual({ first_name: "Anna Maria", last_name: "van Dijk" });
    expect(splitFullName("Oscar De La Hoya")).toEqual({ first_name: "Oscar", last_name: "De La Hoya" });
  });

  it("defaults a plain three-word name to first word + rest", () => {
    expect(splitFullName("Mary Jo Smith")).toEqual({ first_name: "Mary", last_name: "Jo Smith" });
  });

  it("keeps hyphenated and apostrophe names intact", () => {
    expect(splitFullName("Mary-Jo Smith-Jones")).toEqual({ first_name: "Mary-Jo", last_name: "Smith-Jones" });
    expect(splitFullName("Shaun O'Brien")).toEqual({ first_name: "Shaun", last_name: "O'Brien" });
  });

  it("drops middle initials", () => {
    expect(splitFullName("Mary J. Smith")).toEqual({ first_name: "Mary", last_name: "Smith" });
    expect(splitFullName("John Q Public")).toEqual({ first_name: "John", last_name: "Public" });
  });

  it("returns nothing for empty or credential-only cells", () => {
    expect(splitFullName("")).toEqual({});
    expect(splitFullName("   ")).toEqual({});
    expect(splitFullName("Dr.")).toEqual({});
    expect(splitFullName("MD")).toEqual({});
  });

  it("does not treat an honorific-looking surname as a suffix", () => {
    // "Do" is a real surname; only strip DO when it trails a longer name.
    expect(splitFullName("Hana Do")).toEqual({ first_name: "Hana", last_name: "Do" });
  });

  it("treats honorific + single word as a surname, not a first name", () => {
    // Greeting "Hi Smith," is worse than an empty first name (templates
    // fall back to "there").
    expect(splitFullName("Dr. Smith")).toEqual({ last_name: "Smith" });
  });
});

describe("guessField header detection", () => {
  it("maps name-ish headers to full_name", () => {
    expect(guessField("Name")).toBe("full_name");
    expect(guessField("Full Name")).toBe("full_name");
    expect(guessField("contact_name")).toBe("full_name");
  });

  it("keeps explicit first/last headers as before", () => {
    expect(guessField("First Name")).toBe("first_name");
    expect(guessField("surname")).toBe("last_name");
  });
});

describe("rowsToRecipients with a full_name column", () => {
  it("splits the cell into first/last", () => {
    const mapping: RecipientField[] = ["email", "full_name"];
    const { recipients } = rowsToRecipients([["jane@x.com", "Dr. Jane van der Berg"]], mapping);
    expect(recipients).toEqual([{ email: "jane@x.com", first_name: "Jane", last_name: "van der Berg" }]);
  });

  it("never overwrites explicit First/Last columns", () => {
    const mapping: RecipientField[] = ["email", "full_name", "first_name"];
    const { recipients } = rowsToRecipients([["jane@x.com", "Janet Smithers", "Jane"]], mapping);
    expect(recipients).toEqual([{ email: "jane@x.com", first_name: "Jane", last_name: "Smithers" }]);
  });

  it("leaves the recipient bare when the name cell is empty", () => {
    const mapping: RecipientField[] = ["email", "full_name"];
    const { recipients } = rowsToRecipients([["jane@x.com", ""]], mapping);
    expect(recipients).toEqual([{ email: "jane@x.com" }]);
  });
});
