# Policy file

A policy tells Overhear what your agent's tools are. Without one, Overhear guesses from tool names and from what the tools sent and returned. A guess can't prove a tool does not exist, so when the agent says it is transferring a caller and the call has no transfer, Overhear reads Couldn't check, never Failed. It can't tell "never attempted" from "attempted through a tool I did not recognise".

With a policy, you promise that it names every tool your agent has. Overhear then trusts that promise. If the agent says it is transferring the caller and your policy has no transfer tool, or the tool was never called, the call reads Failed.

A policy is a JSON file. There is no other format. The file is checked against the same schema Overhear uses inside every report (`PolicySchema` in `src/report/schema.ts`), and the policy that judged a call is saved in that call's report.

## Using it

On the command line, pass the file with `--policy`:

```
npm run check -- reports/ --policy policy.json
```

In the local dashboard, save the file as `policy.json` in the Overhear folder (`~/.overhear/policy.json`, or `$OVERHEAR_HOME/policy.json` when you set that). The dashboard reads it for every call it checks, both pulled Retell calls and opened session reports, and picks up edits on the next call. If the file is not a valid policy, the dashboard ignores it, writes one fixed sentence to its log, and checks calls as if the file were not there. Run the command line check on the same file to see what is wrong with it. The hosted demo never reads a policy file.

The Overhear folder and the file must belong to you, and neither may be writable by anyone else. The file must be a plain file, not a symlink, and under 256 KB.

## An example

This is a complete policy for a clinic agent that can look up open slots, verify a patient, book and cancel appointments, and transfer a caller to a nurse.

```json
{
  "packs": ["healthcare"],
  "timezone": "America/New_York",
  "success": "result.ok",
  "tools": {
    "verify_patient": {
      "role": "verify",
      "success": "result.verified",
      "patientId": "result.patientId"
    },
    "check_availability": {
      "role": "lookup",
      "items": "result.slots",
      "id": "item.id"
    },
    "book_appointment": {
      "role": "change",
      "kind": "book",
      "id": "args.slotId",
      "patientId": "args.patientId"
    },
    "cancel_appointment": {
      "role": "change",
      "kind": "cancel",
      "id": "args.appointmentId",
      "required": []
    },
    "transfer_to_nurse": {
      "role": "transfer"
    }
  },
  "fields": {
    "date": { "path": "item.startsAt", "type": "date", "required": true },
    "time": { "path": "item.startsAt", "type": "time", "required": true },
    "provider": { "path": "item.providerName", "type": "name" }
  }
}
```

## What each field does

`packs` says which groups of checks run. `scheduling` checks that what the agent promised was done, that the details it spoke match what was committed, and that a transfer it promised happened. `healthcare` runs those and adds a check that the patient was verified before any change.

`timezone` is an IANA name such as `America/New_York`. It is the zone your tools store times in, and Overhear reads spoken times in it. Leave it out and Overhear uses the zone of the machine running the check, or the one you pass with `--tz`.

`success` is a path to a true or false value in a tool's result that says whether the tool worked, used for every tool that does not set its own. Leave it out and Overhear uses what the platform reports, unless the result reads like an error, in which case it says it could not check.

`tools` lists every tool the agent has, by its exact name. Each tool has these keys:

- `role` is one of `verify`, `lookup`, `change` or `transfer`. It is the only required key. A verify tool proves who the caller is. A lookup tool lists options, such as open slots. A change tool books, cancels, reschedules or updates something. A transfer tool hands the caller to a person or another line.
- `kind` is for change tools only: `book`, `cancel`, `reschedule` or `update`.
- `success` is a path to a true or false value in this tool's result.
- `id` names which item a change acts on. For a lookup it is a path inside one item, such as `item.id`. For a change it is a path to the argument that holds the same id, such as `args.slotId`. This is how Overhear knows which slot a booking took, and so which date and time were committed.
- `items` is for lookup tools: the path to the list of options in the result.
- `patientId` is where the patient's id sits: in a verify tool's result, and in a change tool's arguments. It lets Overhear match a change to the patient who was verified.
- `required` is a list of field names that must have a value for this tool's change. Leave it out and the fields marked required in `fields` apply. An empty list means none are required, which suits a cancel tool that has no date or time.

`fields` names the details Overhear compares between what the agent said and what the system committed. Each has a `path` and a `type`. The types are `date`, `time`, `datetime`, `name`, `string`, `number`, `money` and `id`. Set `required` to true when a detail with no value should stop Overhear from calling the call checked. The keys `date`, `time` and `provider` are the ones the scheduling checks compare.

Every path starts with a root. `args` is the arguments the agent sent to the tool. `result` is what the tool returned. `item` is one entry of a lookup's list. `call` is the call's own fields. After the root come the names to follow, separated by dots, and a number picks an entry from a list, as in `result.slots.0.id`. A path that starts with anything else makes the call read as an error that names the path.

`request` is optional and reserved for a later check that compares what the caller asked for with what was committed. Leave it out.

## What changes when you give one

The checks that need to know every tool become strict.

- A transfer the agent promised, with no call to a transfer tool, reads Failed. Without a policy it reads Couldn't check.
- A booking the agent announced with no call to a change tool reads Failed. That already holds without a policy, so a policy does not change it, but the tools you name are how Overhear knows which calls count as bookings.
- A tool the call used that your policy does not name is treated as unknown, and Overhear says it could not check what it did. Add it to the policy to have it checked.
- The details of a committed change are read from the paths you gave, so a wrong date, time or provider in what the agent said is found by name.

If a policy is incomplete, a call can read Failed when the agent did nothing wrong. That is the cost of the promise. When a Failed call surprises you, look first for a tool the policy does not name.

## A worked example

`examples/livekit-clinic/policy.json` is the policy for the LiveKit clinic agent in `examples/livekit-clinic/`. Its README shows the command that uses it.
