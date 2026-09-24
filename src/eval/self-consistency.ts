// Measures how much the (non-deterministic) judge disagrees with itself across
// K repeat runs of the same call. Per case and dimension, agreement is the share
// of the K verdicts that fall on the majority side (max(trues, falses) / K); this
// handles ties cleanly (a 1-1 split is 0.5). Averaged across cases per dimension,
// then across dimensions for the overall number. Higher is more trustworthy.
export interface Consistency {
  perDimension: Record<string, { agreement: number; n: number }>;
  overall: number;
  k: number;
}

export function selfConsistency(caseSamples: Record<string, boolean>[][], keys: string[]): Consistency {
  const perDimension: Record<string, { agreement: number; n: number }> = {};
  for (const key of keys) {
    let sum = 0;
    let n = 0;
    for (const samples of caseSamples) {
      if (samples.length === 0) continue;
      const trues = samples.filter((s) => s[key] === true).length;
      const falses = samples.filter((s) => s[key] === false).length;
      const total = trues + falses;
      if (total === 0) continue;
      sum += Math.max(trues, falses) / total;
      n += 1;
    }
    perDimension[key] = { agreement: n === 0 ? 0 : sum / n, n };
  }
  const agreements = keys.map((key) => perDimension[key].agreement);
  const overall = agreements.length === 0 ? 0 : agreements.reduce((a, b) => a + b, 0) / agreements.length;
  const k = caseSamples[0]?.length ?? 0;
  return { perDimension, overall, k };
}
