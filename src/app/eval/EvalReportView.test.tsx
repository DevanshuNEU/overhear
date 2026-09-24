import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EvalReportView } from "./EvalReportView";
import type { EvalReport } from "@/eval/report";

const sample: EvalReport = {
  generatedAt: "2026-09-23T00:00:00Z",
  goldSetSize: 2,
  rubric: { weights: {} as never, dimensionKeys: [] },
  runs: [
    {
      judge: { source: "claude", model: "claude-sonnet-5", temperature: 0 },
      metrics: {
        failureDetection: {
          perCategory: {
            hallucinated_slot: { precision: 1, recall: 1, f1: 1, tp: 1, fp: 0, fn: 0, support: 1 },
          } as never,
          macroF1: 1,
          microF1: 1,
        },
        scoreCalibration: { bandAccuracy: 1, meanBandDistance: 0, inBand: 2, total: 2 },
        dimensionAgreement: {},
        byLabelSource: {} as never,
      },
      cases: [
        {
          id: "g1",
          labelSource: "objective",
          gold: { failures: [], band: "clean" },
          predicted: { failures: [], composite: 99, band: "clean" },
          failuresCorrect: true,
          bandCorrect: true,
        },
      ],
    },
  ],
};

describe("EvalReportView", () => {
  it("shows the headline counts and each gold case", () => {
    render(<EvalReportView report={sample} />);
    expect(screen.getByText(/of 2/i)).toBeInTheDocument(); // band accuracy raw count "2 of 2"
    expect(screen.getByText("g1")).toBeInTheDocument();
  });

  it("shows the sample-data banner when the report is a placeholder", () => {
    render(<EvalReportView report={{ ...sample, placeholder: true }} />);
    expect(screen.getByText(/sample data/i)).toBeInTheDocument();
  });

  it("does not show the sample-data banner for a real report", () => {
    render(<EvalReportView report={sample} />);
    expect(screen.queryByText(/sample data/i)).not.toBeInTheDocument();
  });
});
