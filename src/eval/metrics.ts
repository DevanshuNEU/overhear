import type { FailureCategory } from "@/domain/types";
import { type Band, type CategoryMetric, BAND_ORDER } from "./report";

export function bandOf(composite: number): Band {
  if (composite >= 90) return "clean";
  if (composite >= 70) return "minor";
  if (composite >= 40) return "serious";
  return "broken";
}

export function bandDistance(a: Band, b: Band): number {
  return Math.abs(BAND_ORDER.indexOf(a) - BAND_ORDER.indexOf(b));
}

function f1From(precision: number, recall: number): number {
  return precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
}

function categoryMetric(tp: number, fp: number, fn: number): CategoryMetric {
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  return { precision, recall, f1: f1From(precision, recall), tp, fp, fn, support: tp + fn };
}

export function failureDetection(
  cases: { predicted: FailureCategory[]; expected: FailureCategory[] }[],
  categories: readonly FailureCategory[],
): { perCategory: Record<FailureCategory, CategoryMetric>; macroF1: number; microF1: number } {
  const perCategory = {} as Record<FailureCategory, CategoryMetric>;
  let sumTp = 0, sumFp = 0, sumFn = 0;
  for (const cat of categories) {
    let tp = 0, fp = 0, fn = 0;
    for (const c of cases) {
      const inPred = c.predicted.includes(cat);
      const inGold = c.expected.includes(cat);
      if (inPred && inGold) tp++;
      else if (inPred && !inGold) fp++;
      else if (!inPred && inGold) fn++;
    }
    perCategory[cat] = categoryMetric(tp, fp, fn);
    sumTp += tp; sumFp += fp; sumFn += fn;
  }
  const macroF1 = categories.length === 0 ? 0
    : categories.reduce((a, cat) => a + perCategory[cat].f1, 0) / categories.length;
  const micro = categoryMetric(sumTp, sumFp, sumFn);
  return { perCategory, macroF1, microF1: micro.f1 };
}

export function scoreCalibration(
  cases: { predictedComposite: number; expectedBand: Band }[],
): { bandAccuracy: number; meanBandDistance: number; inBand: number; total: number } {
  const total = cases.length;
  if (total === 0) return { bandAccuracy: 0, meanBandDistance: 0, inBand: 0, total: 0 };
  let inBand = 0, distSum = 0;
  for (const c of cases) {
    const d = bandDistance(bandOf(c.predictedComposite), c.expectedBand);
    if (d === 0) inBand++;
    distSum += d;
  }
  return { bandAccuracy: inBand / total, meanBandDistance: distSum / total, inBand, total };
}

export function dimensionAgreement(
  cases: { predicted: Record<string, boolean>; expected: Record<string, boolean | undefined> }[],
  key: string,
): { agreement: number; matches: number; n: number } {
  let matches = 0, n = 0;
  for (const c of cases) {
    if (c.expected[key] === undefined) continue;
    n++;
    if (c.predicted[key] === c.expected[key]) matches++;
  }
  return { agreement: n === 0 ? 0 : matches / n, matches, n };
}
