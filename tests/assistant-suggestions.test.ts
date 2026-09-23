import { describe, expect, it } from "vitest";
import { suggestedQuestions } from "../lib/assistant-suggestions";
import type { Recommendation } from "../lib/contracts/engine";

function row(code: string, values: Partial<Recommendation> = {}): Recommendation {
  return {
    key: `IEK:${code}`, supplier: "IEK", code, quantity: 1, confidence: "high",
    needsReview: false, warnings: [], anomalies: [], ...values,
  } as Recommendation;
}

describe("assistant question suggestions", () => {
  it("uses three different SKUs even when the first has every warning", () => {
    const rows = [
      row("FIRST", { needsReview: true, warnings: ["review"], anomalies: [{} as Recommendation["anomalies"][number]] }),
      row("SECOND", { confidence: "low" }),
      row("THIRD", { anomalies: [{} as Recommendation["anomalies"][number]] }),
      row("FOURTH"),
    ];
    const questions = suggestedQuestions(rows);
    expect(questions).toHaveLength(3);
    expect(questions[0]).toContain("IEK FIRST");
    expect(questions[1]).toContain("IEK SECOND");
    expect(questions[2]).toContain("IEK THIRD");
  });

  it("only uses the first ten rows and fills missing SKUs with general questions", () => {
    const rows = [row("ONLY"), ...Array.from({ length: 9 }, () => row("ONLY")), row("ELEVENTH")];
    const questions = suggestedQuestions(rows);
    expect(questions).toHaveLength(3);
    expect(questions[0]).toContain("IEK ONLY");
    expect(questions.slice(1).join(" ")).not.toContain("IEK ONLY");
    expect(questions.join(" ")).not.toContain("ELEVENTH");
  });
});
