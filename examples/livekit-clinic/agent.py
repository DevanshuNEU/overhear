"""A small clinic front-desk voice agent that saves one LiveKit session report per call.

Run `python agent.py console` to talk to it with no LiveKit server. Each call
writes reports/<job id>-<timestamp>.json, which Overhear reads with
`npm run check -- examples/livekit-clinic/reports`.
"""

import json
import os
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    JobContext,
    RunContext,
    ToolError,
    cli,
    function_tool,
)

load_dotenv(Path(__file__).parent / ".env.local")

REPORTS_DIR = Path(__file__).parent / "reports"

# In-memory schedule. Booking flips a slot to taken for the rest of the process.
SLOTS: dict[str, dict] = {
    "slot-1": {"date": "2026-12-03", "time": "09:00", "provider": "Dr. Lee", "open": True},
    "slot-2": {"date": "2026-12-03", "time": "10:30", "provider": "Dr. Lee", "open": True},
    "slot-3": {"date": "2026-12-03", "time": "14:00", "provider": "Dr. Patel", "open": False},
    "slot-4": {"date": "2026-12-04", "time": "11:00", "provider": "Dr. Patel", "open": True},
}

PROMPT = "\n".join(
    [
        "You are Riley, the receptionist at Northwind Family Clinic. You are on a live phone call.",
        "You help callers check appointment availability and book appointments.",
        "Keep each turn to one or two short sentences. Ask one thing at a time.",
        "Say dates and times the way people do, like 'Thursday the 3rd at 9 a.m.'. Never read out slot ids or tool names.",
        "Offer two or three slots at most.",
        "Ask for the caller's full name before booking, and say what you are about to book and get a yes first.",
        "Only offer or book slots that check_availability returned. Never invent a slot, provider or time.",
        "Never give medical advice of any kind, even if asked directly. If a caller asks a medical question, politely decline and offer to connect them with a nurse.",
        "When the caller is done, give a quick recap, say one short goodbye, and stop.",
    ]
)



class ClinicAgent(Agent):
    def __init__(self) -> None:
        super().__init__(instructions=PROMPT)

    async def on_enter(self) -> None:
        self.session.generate_reply(
            instructions="Say: Hi, thanks for calling Northwind Family Clinic, this is Riley. How can I help you today?"
        )

    @function_tool
    async def check_availability(self, context: RunContext, date: str) -> str:
        """Look up open appointment slots for a date. Call this before offering any slot.

        Args:
            date: The calendar date in YYYY-MM-DD format.
        """
        open_slots = [
            {"slot_id": sid, "time": s["time"], "provider": s["provider"]}
            for sid, s in SLOTS.items()
            if s["open"] and s["date"] == date
        ]
        return json.dumps({"date": date, "open_slots": open_slots})

    @function_tool
    async def book_appointment(self, context: RunContext, slot_id: str, patient_name: str) -> str:
        """Book an appointment for a patient into an open slot returned by check_availability.

        Args:
            slot_id: The slot_id of the open slot.
            patient_name: The patient's full name.
        """
        slot = SLOTS.get(slot_id)
        if slot is None:
            raise ToolError(f"Unknown slot {slot_id}")
        if not slot["open"]:
            raise ToolError(f"Slot {slot_id} is already taken")
        slot["open"] = False
        return json.dumps(
            {"status": "booked", "slot_id": slot_id, "patient_name": patient_name, "date": slot["date"], "time": slot["time"]}
        )


def save_report(report_dict: dict, job_id: str, reports_dir: Path = REPORTS_DIR) -> Path:
    """Write one report per call. Console mode reuses job ids, so the timestamp keeps files unique."""
    reports_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    path = reports_dir / f"{job_id}-{stamp}.json"
    path.write_text(json.dumps(report_dict, indent=2))
    return path


async def on_session_end(ctx: JobContext) -> None:
    try:
        report = ctx.make_session_report()
    except RuntimeError:
        return
    path = save_report(report.to_dict(), ctx.job.id)
    print(f"Saved session report to {path}")


server = AgentServer()


@server.rtc_session(on_session_end=on_session_end)
async def entrypoint(ctx: JobContext) -> None:
    session = AgentSession(
        stt="deepgram/nova-3",
        llm="openai/gpt-4.1-mini",
        tts="cartesia/sonic-3:9626c31c-bec5-4cca-baa8-f8ba9e84c8bc",
    )
    await session.start(agent=ClinicAgent(), room=ctx.room)


if __name__ == "__main__":
    cli.run_app(server)
