import { describe, expect, it } from "vitest";
import { pseudonymizeInvoice } from "../../lib/repo/explorer";

describe("pseudonymizeInvoice", () => {
  it("never returns the raw invoice number", () => {
    const pseudonym = pseudonymizeInvoice("dataset-1", "INV-2024-000123");
    expect(pseudonym).not.toContain("2024-000123");
  });

  it("is prefixed with INV- followed by 10 hex characters", () => {
    const pseudonym = pseudonymizeInvoice("dataset-1", "some-invoice-number");
    expect(pseudonym).toMatch(/^INV-[0-9a-f]{10}$/);
  });

  it("is stable for the same dataset and invoice", () => {
    const a = pseudonymizeInvoice("dataset-1", "INV-42");
    const b = pseudonymizeInvoice("dataset-1", "INV-42");
    expect(a).toBe(b);
  });

  it("differs across datasets for the same raw invoice number, so pseudonyms don't correlate across datasets", () => {
    const a = pseudonymizeInvoice("dataset-1", "INV-42");
    const b = pseudonymizeInvoice("dataset-2", "INV-42");
    expect(a).not.toBe(b);
  });

  it("differs across invoice numbers within the same dataset", () => {
    const a = pseudonymizeInvoice("dataset-1", "INV-1");
    const b = pseudonymizeInvoice("dataset-1", "INV-2");
    expect(a).not.toBe(b);
  });
});
