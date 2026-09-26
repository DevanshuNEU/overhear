// TryItCard - tells a visitor exactly how to place a working test call:
// identify as one of the demo personas, then ask to book. Renders straight from
// the shared persona list so it never drifts from the patients the agent can
// actually verify.
import { DEMO_PERSONAS } from "@/demo/personas";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export function TryItCard() {
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm">Try it yourself</CardTitle>
        <CardDescription>
          Start a call, say you are one of these patients, and ask to book an appointment this week.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-4">
        <ul className="flex flex-col divide-y divide-border/60">
          {DEMO_PERSONAS.map((persona) => (
            <li key={`${persona.name}-${persona.dob}`} className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
              <span className="text-foreground">{persona.name}</span>
              <span className="font-mono text-xs text-muted-foreground">{persona.dob}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
