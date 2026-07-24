# Deploying the `intake-lead` function — step by step

This guide assumes you've never used the Supabase CLI before. Follow the
steps in order, on your Mac, in the Terminal app.

Your project is at **https://rswuytyoxpaqcbwfowyw.supabase.co** — the
"project ref" (its short ID) is `rswuytyoxpaqcbwfowyw`. You'll need that
exact string in step 3.

> ⚠️ **Heads up before you start:** the file `supabase/config.toml` in this
> repo currently has a different project ID in it (`mtucgtzyiexmpsslbxpn`)
> than the one above. That's left over from an earlier setup and doesn't
> match your live project. Step 3 below (`supabase link`) will fix this
> automatically, so you don't need to edit anything by hand — just make
> sure you type the ref exactly as shown.

## 1. Install the Supabase CLI

In Terminal, run:

```bash
brew install supabase/tap/supabase
```

If you don't have Homebrew installed, go to https://brew.sh first, run the
one-line install command shown there, then come back and run the line
above.

Check it worked:

```bash
supabase --version
```

You should see a version number printed (e.g. `1.x.x`). If you instead see
"command not found," close and reopen Terminal and try again.

## 2. Log in to Supabase

```bash
supabase login
```

This opens your browser and asks you to approve access. Click **Authorize**.
Come back to Terminal — it should say you're logged in.

## 3. Point this project folder at your live Supabase project

In Terminal, navigate into the project folder first:

```bash
cd /Users/shrushtichavan/Desktop/astrolokalcrm
```

Then link it:

```bash
supabase link --project-ref rswuytyoxpaqcbwfowyw
```

It may ask for your database password — this is the Postgres password you
set when you created the Supabase project (not your Supabase account
password). If you don't remember it, you can reset it from the Supabase
dashboard under **Project Settings → Database → Reset database password**.

## 4. Deploy the function

This is the actual "make it live" step:

```bash
supabase functions deploy intake-lead
```

Wait for it to finish — it'll print a checkmark and a URL when done. That
URL will be:

```
https://rswuytyoxpaqcbwfowyw.supabase.co/functions/v1/intake-lead
```

That's the address the Google Apps Script needs to send its form
submissions to.

**Note:** you do *not* need to set up any secrets or API keys for this
function to work — Supabase automatically gives every Edge Function access
to your project's URL and service role key behind the scenes.

## 5. Test that it's actually working

Still in Terminal, run this (it sends a fake test submission):

```bash
curl -i -X POST 'https://rswuytyoxpaqcbwfowyw.supabase.co/functions/v1/intake-lead' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJzd3V5dHlveHBhcWNid2Zvd3l3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ1NjI1MjAsImV4cCI6MjEwMDEzODUyMH0.O2Qe5y63arcxr2uekmH04aMXDKFkXlzznS0ydWebVzs' \
  -d '{"name":"Test Person","contact":"9999999999","email":null,"city":"Mumbai","language":"Hindi","source":"Test"}'
```

You should get back something like:

```json
{"ok":true,"status":"created","id":"...","lead_id":"REF-..."}
```

If you run the exact same command a second time within a minute, you
should instead get a `409` response saying the lead is active in the
pipeline — that's the dedup logic correctly catching the repeat. Both
outcomes mean the function is working. If you see an error instead, jump to
the Troubleshooting section below.

Once confirmed, you can delete that test lead from the CRM's Admin → All
Leads page so it doesn't show up as a real lead (search for "Test Person").

## 6. Point Google Apps Script at it

In whatever Apps Script is wired to your Google Form, it needs to send a
POST request with these two headers plus a JSON body — for example:

```js
UrlFetchApp.fetch("https://rswuytyoxpaqcbwfowyw.supabase.co/functions/v1/intake-lead", {
  method: "post",
  contentType: "application/json",
  headers: {
    Authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJzd3V5dHlveHBhcWNid2Zvd3l3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ1NjI1MjAsImV4cCI6MjEwMDEzODUyMH0.O2Qe5y63arcxr2uekmH04aMXDKFkXlzznS0ydWebVzs",
  },
  payload: JSON.stringify({
    name: "...",
    contact: "...",
    email: "...", // or null
    city: "...",
    language: "...",
    source: "...",
  }),
  muteHttpExceptions: true, // so Apps Script doesn't throw on a 409/500 — check the response code yourself and send your fallback email if it isn't 200
});
```

That `Authorization` header is your Supabase **anon key** — it's fine for
it to live inside the Apps Script project (it's not a secret; it can't
read or write anything on its own). Do not put your database password or
any "service role" key into Apps Script.

## 7. If you ever need to check what happened (viewing logs)

Either:

- Go to your Supabase dashboard → **Edge Functions** → `intake-lead` →
  **Logs** tab, or
- Run in Terminal:

  ```bash
  supabase functions logs intake-lead
  ```

This shows every request the function has received and any errors, which
is the first place to look if leads stop coming in.

## 8. Making changes later

If this function's code ever needs to change, edit
`supabase/functions/intake-lead/index.ts`, then just re-run step 4
(`supabase functions deploy intake-lead`) again — it replaces the live
version instantly, no other steps needed.

## Troubleshooting

- **"Invalid JWT" / 401 error** — the `Authorization` header is missing or
  wrong. Make sure it's exactly `Bearer ` followed by the anon key with no
  extra spaces or line breaks.
- **"relation does not exist" or similar database error in the response**
  — the linked project (step 3) doesn't match where your `leads` table
  actually lives. Re-run `supabase link --project-ref rswuytyoxpaqcbwfowyw`.
- **CORS error** (only relevant if calling from a browser, not Apps
  Script) — shouldn't happen; the function already allows requests from
  anywhere.
- **Nothing happens / no lead appears** — check the Logs (step 7) for the
  actual error message the function returned.
