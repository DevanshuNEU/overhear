// TryItCard - tells a visitor exactly how to place a working test call:
// identify as one of the demo personas, then ask to book. Renders straight from
// the shared persona list so it never drifts from the patients the agent can
// actually verify.
import { DEMO_PERSONAS } from "@/demo/personas";

export function TryItCard() {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-ink-raised px-4 py-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium text-zinc-200">Try it yourself</h2>
        <p className="text-sm text-zinc-400">
          Start a call, say you are one of these patients, and ask to book an appointment this week.
        </p>
      </div>
      <ul className="flex flex-col gap-1">
        {DEMO_PERSONAS.map((persona) => (
          <li key={`${persona.name}-${persona.dob}`} className="flex items-baseline gap-3 text-sm">
            <span className="text-zinc-200">{persona.name}</span>
            <span className="font-mono text-zinc-500">{persona.dob}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
