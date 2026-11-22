# The demo agent

The sample calls in Overhear come from a demo clinic agent. This page covers how its backend is set up and deployed. You do not need any of it to check your own calls. For that, see the README.

The agent is a Retell voice agent for a clinic called Northwind. It books, moves and cancels appointments through five tool endpoints in this repo. They live under `src/app/api/tools/` and keep their data in Postgres. Retell also sends call events to `src/app/api/webhooks/retell`. That route checks the signature, logs the event type and call id, and answers 200. It stores nothing.

## Run it on your machine

You need Node 20.9 or newer and Docker for a local Postgres.

```bash
# 1. Install dependencies
npm ci

# 2. Copy the example env file and fill it in
cp .env.example .env

# 3. Start Postgres and apply the migrations
docker compose up -d
npm run db:migrate

# 4. Add the clinic data: providers, open slots and patients
npm run db:seed

# 5. Run and check
npm run dev
npm test
npm run lint
npm run build
```

Run `npm run db:generate` only when you change `src/db/schema.ts`. It writes a new migration. Never edit a migration that has already shipped.

Creating the Retell agent needs a Retell API key and a public `APP_URL`, because Retell calls your tool and webhook endpoints over the internet. So `npm run provision:agent` is a deploy step. It is not part of local setup.

## Environment

Copy `.env.example` and set these.

Required:

- `DATABASE_URL`: the Postgres connection string.
- `RETELL_API_KEY`: your Retell API key. It must be the key Retell badges for webhooks, because Retell signs tool calls and webhooks with it.
- `APP_URL`: the public address of the service, for example `https://your-service.up.railway.app`. The agent's tool and webhook URLs are built from it.

For the public demo:

- `RETELL_AGENT_ID`: the id that `npm run provision:agent` prints. Set it after you create the agent. The "Call the demo agent" button on the public page starts calls to this agent, and Overhear uses the demo's own policy for calls from it.
- `OVERHEAR_PUBLIC_SAMPLES`: set it to `1` to show the home page, the sample reports and the demo call routes without the password. Every other page keeps the password. Leave it unset and nothing is public.
- `DASHBOARD_PASSWORD`: a shared password for everything that is not public. Leave it empty to open the whole app. The tool and webhook routes never use it, because Retell cannot send one.

`OVERHEAR_DEMO_AGENT_ID` is optional. When it is blank, Overhear uses `RETELL_AGENT_ID` instead.

## Deploy to Railway

The service is one web service plus the Railway Postgres plugin. `railway.json` sets the build and deploy steps, so the Nixpacks builder needs no other setup.

- Build: `npm run build`
- Pre deploy step, run once before the new container takes traffic: `npm run db:migrate:deploy`, which runs `drizzle-kit migrate` against `DATABASE_URL`
- Start: `npm run start`
- Health check: `/api/health`

Migrations run before the app comes up, so every deploy applies pending schema changes. There is no separate migration step to remember.

### Set up the project

1. Create a Railway project and link this repo as a service.
2. Add a Postgres plugin. Railway sets `DATABASE_URL` on the web service.
3. Set these variables on the web service:
   - `RETELL_API_KEY`
   - `APP_URL`, the public address Railway gives the service
   - `DASHBOARD_PASSWORD`, if you want a password
   - `OVERHEAR_PUBLIC_SAMPLES=1`, if you want the public page
   - Leave `RETELL_AGENT_ID` unset for the first deploy. You add it below.
4. Deploy. Railway builds the app, runs the migrations, then starts it.

### Go live

1. Deploy as above and note the public `APP_URL`.
2. On your machine, with `APP_URL` set to that address and your `RETELL_API_KEY` in `.env`, run `npm run provision:agent`. It creates the Retell agent with tool and webhook URLs that point at production. It prints a `RETELL_AGENT_ID`.
3. Put that `RETELL_AGENT_ID` in the Railway variables and redeploy.
4. Run `npm run db:seed` once against the production `DATABASE_URL`, so the clinic has providers, slots and patients. After that, the open slots top themselves up each time a visitor starts a call.
5. Open the public page, check that the sample calls show, choose "Call the demo agent", book an appointment, and check that your call appears with a verdict.

## How the agent checks who is calling, and its limits

The agent asks for the caller's full name, has them spell it letter by letter, reads the spelling back, then asks for the date of birth and reads it back. Only then does it call `verify_patient`. When that finds a file, the agent says the name on file and asks "Is that you?" before it books, moves or cancels anything.

`verify_patient` looks up every patient with that exact date of birth and picks the one whose name is most similar to what the caller said (similarity of at least 0.65, in `src/clinic/service.ts`). Matching loosely means a misheard name still finds the right file. It also brings two known gaps:

- **Two patients with the same name and the same date of birth.** The lookup picks one of them, and the caller can't tell which. It isn't handled yet. Fixes, in order of preference: (1) when more than one file matches, return "more than one match" instead of a patient, and have the agent ask for a third detail, such as the phone number on file or a postcode; (2) for phone calls, check the caller's number against the number on file; (3) when it still can't tell, hand the caller to staff and change nothing.
- **A similar name with the same date of birth.** A different patient whose name sounds close could match. Spelling the name and confirming the name on file make this unlikely, but the lookup itself is still loose. The fix is to match the spelled name exactly, and use similarity only to suggest "did you mean" while the caller confirms.

These matter for the demo clinic only. Overhear itself doesn't verify anyone: it checks whether what the agent said matches what its tools did. A check that the agent verified the caller before changing an appointment is designed but not built yet.
