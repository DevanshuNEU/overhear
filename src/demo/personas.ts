// Shared source of truth for the demo test personas. Both the data setup
// (ensureDemoData) and the "Try it yourself" card render from this list, so a
// persona shown on the page is always one the caller can actually verify as.
// All synthetic.
export interface Persona {
  name: string;
  dob: string; // YYYY-MM-DD
}

export const DEMO_PERSONAS: Persona[] = [
  { name: "Devanshu Chicholikar", dob: "1994-07-14" },
  { name: "Aisha Rahman", dob: "1991-08-17" },
  { name: "Marcus Bennett", dob: "1983-04-05" },
  { name: "Sofia Alvarez", dob: "1996-11-23" },
  { name: "Kenji Watanabe", dob: "1978-06-30" },
];
