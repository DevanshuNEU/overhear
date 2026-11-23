// Shared source of truth for the demo clinic's doctors. The seed creates exactly these providers and the demo call band
// names them to the caller, so a doctor shown on the page is one the agent can actually book. ensureDemoData tops up
// slots for whichever providers the seed created. All synthetic.
export interface DemoProvider {
  name: string;
  specialty: string;
}

export const DEMO_PROVIDERS: DemoProvider[] = [
  { name: "Dr. Amara Osei", specialty: "Family Medicine" },
  { name: "Dr. Priya Nair", specialty: "Pediatrics" },
  { name: "Dr. Miguel Torres", specialty: "Internal Medicine" },
];
