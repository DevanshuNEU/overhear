// Three real calls on the demo agent, scrubbed, as call reports. The dashboard builds its screens
// from these until the engine produces reports of its own, and the engine's tests compare against
// them. They are the JSON files next to this one, so there is one copy of each.
import { CallReportSchema, type CallReport } from "../schema";
import failed from "./failed.json";
import needsReview from "./needs-review.json";
import passed from "./passed.json";

export const failedSample: CallReport = CallReportSchema.parse(failed);
export const needsReviewSample: CallReport = CallReportSchema.parse(needsReview);
export const passedSample: CallReport = CallReportSchema.parse(passed);

export const SAMPLE_REPORTS: CallReport[] = [failedSample, needsReviewSample, passedSample];
