# Form intake scripts

Four Google Apps Script files, one per Google Form. Each one watches its
form for new submissions and sends the answers straight into the CRM via
the `intake-lead` Supabase Edge Function
(`supabase/functions/intake-lead/` in this repo). If that call doesn't
succeed for any reason, the script emails the raw answers to
**shrushti.chavan@getlokalapp.com** and **tejaswi@getlokalapp.com** so
nothing gets lost — the lead can then be added to the CRM by hand.

| File | Form | Source tag |
|---|---|---|
| `referral-program.gs` | Exclusive Referral Program | `Referral` |
| `outbound-application.gs` | AstroLokal Astrologer Application Form (Outbound) | `OutBound Leads` |
| `linkedin-application.gs` | AstroLokal Astrologer Application Form - Linkedin | `Linkedin` |
| `cs-onboarding.gs` | CS Onboarding Form | `CS ticket` |

## What each script does

On every submission:

1. Reads every question/answer pair off the response.
2. Maps the ones the CRM cares about (name, contact, email, city,
   language) using that form's own question titles — see the `FIELD_MAP`
   near the top of each file. Any CRM field a form doesn't ask for (e.g.
   email on the Referral form) is sent as `null`.
3. Adds a fixed `source` value (see table above) so every lead created
   from that form is tagged consistently in the CRM.
4. Sends it all as JSON to the Edge Function.
5. If the response isn't a success (200/201), or the request fails
   outright (network error, timeout, etc.), emails the two addresses
   above with subject `Lead intake failed - [Form Name]` and every raw
   answer from the submission in the body — so even a failed lead can be
   entered manually with nothing missing.

If the Edge Function responds successfully, the script does nothing else
— the lead is already in the database at that point.

Nothing here needs editing for normal use. The only things you'd ever
change are the values at the top of a file (`FORM_NAME`, `SOURCE`,
`NOTIFY_EMAILS`, `FIELD_MAP`) if a form's questions or destination email
addresses change later.

## How to paste a script into its Google Form (step by step)

Do this once per form, using the matching `.gs` file from the table above.

1. Open the Google Form in your browser (the one you want to wire up).
2. Click the **⋮** (three dots) menu in the top-right corner of the form
   editor, then choose **Script editor**. (On some forms this is under a
   **Extensions**-style menu instead — either way, look for "Script
   editor" or "Apps Script.")
3. A new tab opens with the Apps Script editor. It'll show a file called
   `Code.gs` with a little bit of placeholder text in it (maybe just
   `function myFunction() {}`).
4. Click inside that code area, select everything (⌘A on Mac, Ctrl+A on
   Windows), and delete it.
5. Open the matching `.gs` file from this folder in a text editor (or on
   GitHub), select everything, and copy it.
6. Paste it into the empty Apps Script editor.
7. Click the **save icon** (or ⌘S / Ctrl+S). You'll be asked to name the
   project the first time — any name is fine, e.g. "Lead intake."

That's it for the code. Next, set up the trigger below — without it, the
script exists but never actually runs.

## How to set the "on form submit" trigger

This tells Google "run this script every time someone submits the form."

1. Still inside the Apps Script editor (from the steps above), look at
   the left-hand sidebar for a clock icon labeled **Triggers**. Click it.
2. Click the blue **+ Add Trigger** button in the bottom-right.
3. Set the options exactly like this:
   - **Choose which function to run** → `onFormSubmit`
   - **Choose which deployment should run** → `Head`
   - **Select event source** → `From form`
   - **Select event type** → `On form submit`
   - **Failure notification settings** → leave on the default (you'll
     also get the CRM's own failure email, but Google's built-in one
     doesn't hurt as a backup)
4. Click **Save**.
5. The first time you save, Google will ask you to authorize the script
   (it needs permission to make web requests and send email on your
   behalf). Click through:
   - Choose your account.
   - You'll likely see a screen saying **"Google hasn't verified this
     app."** This is completely normal for a script you wrote/pasted
     yourself — it's not a public app, just your own automation. Click
     **Advanced**, then **Go to [project name] (unsafe)**, then
     **Allow**.
6. You should land back on the Triggers page with your new trigger
   listed. Done — the form is now live.

## How to test it with a dummy submission

You don't have to actually fill out and submit the real form to check
this is working. Every script includes a `testWithDummySubmission`
function that sends fake sample data through the exact same code path.

1. In the Apps Script editor, find the function dropdown in the toolbar
   at the top (it might say `onFormSubmit` by default).
2. Change it to `testWithDummySubmission`.
3. Click the **Run** button (▶) next to it.
4. First time only, you'll get the same authorization prompt as above —
   approve it the same way.
5. Wait a few seconds, then check the result two ways:
   - Open the CRM and go to **Admin → All Leads**, search for
     **"Test Person"**. If it's there, the function worked end-to-end.
   - If it's *not* there, check the inbox of
     shrushti.chavan@getlokalapp.com — you should have gotten a
     "Lead intake failed" email instead, which will tell you what went
     wrong.
6. You can also click **Executions** in the left sidebar of the Apps
   Script editor to see the run's logs directly, including any error
   message.
7. Once you're satisfied it worked, delete the "Test Person" lead from
   Admin → All Leads so it doesn't sit in the pipeline as a fake lead.

If the dummy test works, real form submissions will work the same way —
they run through identical code, just with real answers instead of the
sample ones.
