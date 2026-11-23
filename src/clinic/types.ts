// The two small types the clinic service and the agent config share.

export type ToolName =
  | "check_availability" | "verify_patient" | "book_appointment"
  | "reschedule_appointment" | "cancel_appointment";

export interface Slot { id: string; providerId: string; providerName: string; startsAt: string; startsAtLocal?: string; forCaller?: string; status: "open" | "booked"; }
