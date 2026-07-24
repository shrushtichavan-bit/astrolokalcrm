/**
 * Google Apps Script — bound to the Google Form "Exclusive Referral Program".
 *
 * Fires on every form submission, maps the form's answers onto the CRM's
 * lead-intake shape, and POSTs them to the intake-lead Supabase Edge
 * Function. If that call fails for any reason, emails the raw answers to
 * the team so nothing is lost.
 *
 * See ../README.md for setup instructions (paste-in, trigger, testing).
 */

var EDGE_FUNCTION_URL = "https://rswuytyoxpaqcbwfowyw.supabase.co/functions/v1/intake-lead";
var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJzd3V5dHlveHBhcWNid2Zvd3l3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ1NjI1MjAsImV4cCI6MjEwMDEzODUyMH0.O2Qe5y63arcxr2uekmH04aMXDKFkXlzznS0ydWebVzs";

var FORM_NAME = "Exclusive Referral Program";
var SOURCE = "Referral";
var NOTIFY_EMAILS = ["shrushti.chavan@getlokalapp.com", "tejaswi@getlokalapp.com"];

// Map our CRM fields to this form's exact question titles.
// Use null for any field this form doesn't ask.
var FIELD_MAP = {
  name: "Full Name",
  contact: "Mobile Number",
  email: null,
  city: "What city are you currently based out of?",
  language: "Which languages can you conduct full consultations in — both speaking and chat? (Primary Language)",
};

/** Real trigger entry point — wire this up as the "On form submit" trigger (see README). */
function onFormSubmit(e) {
  var raw = getRawAnswers_(e);
  processSubmission_(raw);
}

/** Run this manually from the Apps Script editor to test end-to-end without a real form submission. */
function testWithDummySubmission() {
  var raw = {};
  raw["Full Name"] = "Test Person";
  raw["Mobile Number"] = "9999999999";
  raw["What city are you currently based out of?"] = "Mumbai";
  raw["Which languages can you conduct full consultations in — both speaking and chat? (Primary Language)"] = "Hindi";
  processSubmission_(raw);
  Logger.log('Dummy submission sent. Check Admin > All Leads in the CRM for "Test Person", or the notify inbox if it failed.');
}

function processSubmission_(raw) {
  var payload = {
    name: fieldFromMap_(raw, "name") || "",
    contact: fieldFromMap_(raw, "contact") || "",
    email: fieldFromMap_(raw, "email"),
    city: fieldFromMap_(raw, "city"),
    language: fieldFromMap_(raw, "language"),
    source: SOURCE,
  };

  try {
    var response = UrlFetchApp.fetch(EDGE_FUNCTION_URL, {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: "Bearer " + SUPABASE_ANON_KEY },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });

    var code = response.getResponseCode();
    if (code !== 200 && code !== 201) {
      notifyFailure_(raw, "HTTP " + code + ": " + response.getContentText());
    }
  } catch (err) {
    notifyFailure_(raw, "Request failed: " + err.message);
  }
}

/** Looks up one CRM field's raw answer via FIELD_MAP; returns null if the field isn't on this form or wasn't answered. */
function fieldFromMap_(raw, mapKey) {
  var title = FIELD_MAP[mapKey];
  if (!title) return null;
  var value = raw[title];
  return value ? String(value).trim() : null;
}

/** Reads every question/answer pair off the submitted response, keyed by exact question title. */
function getRawAnswers_(e) {
  var raw = {};
  var itemResponses = e.response.getItemResponses();
  for (var i = 0; i < itemResponses.length; i++) {
    var item = itemResponses[i];
    var answer = item.getResponse();
    if (Array.isArray(answer)) answer = answer.join(", ");
    raw[item.getItem().getTitle()] = answer;
  }
  return raw;
}

function notifyFailure_(raw, errorDetail) {
  var lines = [];
  lines.push('The lead intake function failed for a new submission to "' + FORM_NAME + '".');
  lines.push("");
  lines.push("Error: " + errorDetail);
  lines.push("");
  lines.push("Raw form answers (nothing was lost — this lead needs to be added to the CRM manually):");
  lines.push("");
  for (var key in raw) {
    if (Object.prototype.hasOwnProperty.call(raw, key)) {
      lines.push(key + ": " + raw[key]);
    }
  }

  MailApp.sendEmail({
    to: NOTIFY_EMAILS.join(","),
    subject: "Lead intake failed - " + FORM_NAME,
    body: lines.join("\n"),
  });
}
