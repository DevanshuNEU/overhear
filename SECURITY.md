# Security

## Report a problem

Open a private security advisory on GitHub for this repository. Please do not open a public issue for a security problem.

## What stays where

### Local mode

- Your Retell key is saved in a file in your home directory. The folder is readable only by you, and so is the file.
- The server listens on loopback only (127.0.0.1) and refuses any request whose Host is not loopback.
- Every request that changes something must come from the same origin, and cross-site requests are refused.
- The key is never logged. It is sent only to Retell. It is never sent to the browser.
- Your calls never leave your machine. They are fetched from Retell, checked on your machine, and shown to you.

### The public demo

- A hosted copy holds no Retell key of its own for visitors to use. It talks to the demo agent only.
- A visitor's call is shown only to that visitor. A signed cookie names the call, and the server checks it on every read.
- The call is kept in memory for an hour. Overhear writes no call to a database or to disk. A restart forgets every call.
- Retell records calls on the demo account. That recording is Retell's, not Overhear's.
- Spend is limited. Each visitor gets 3 starts per 10 minutes and 6 per day, and the whole server gets 30 per hour. A start that Retell did not accept is not counted.
- A hosted copy with no password set answers 503 on every page that is not a public sample.

### For the owner of a hosted copy

Open `/owner` before a demo and enter the password. It sets a 12 hour cookie so the call button skips the public limits. Without a password set, the page does not exist.

## Reviewed on 2026-11-21

A review of the code, the dependencies and a running build found these, and all of them are fixed:

- Next.js and the packages with open advisories (undici, zod, sharp) were upgraded. The production dependencies now have no known advisories.
- The image optimizer no longer fetches remote addresses.
- The public demo could be locked for an hour by a flood of start requests. Failed starts are now refunded, visitors have a daily cap, and the owner has a separate budget.
- A hosted copy with a blank password used to be open. It now answers 503.
- Security headers are now sent on every page: no framing, no content sniffing, a strict referrer policy and a limited permissions policy.
- The rate limiter now frees the memory it holds for visitors who have gone away.
- The webhook no longer stores calls, and the privacy text on the demo page now says what happens to a call.

## Reviewed on 2026-11-22

A second review of everything added since, and live tests against the public demo, found these, and all of them are fixed:

- The visitor limit counted a header the visitor could set. It now counts the address Railway's edge records (`X-Real-IP`), and a live test confirms a fourth start in 10 minutes is refused.
- Request bodies over 1 MB are refused on a hosted copy, and only a local copy accepts the larger uploads that opened session report files need.
- The demo origin check compares the full origin, scheme and port included.
- A test patient row carrying a real person's details was removed from the demo database.

## What Overhear does not claim

Overhear is not a HIPAA covered service. It makes no compliance claim of any kind. Do not put real patient information into the public demo.
