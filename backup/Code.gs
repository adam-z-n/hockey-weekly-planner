/**
 * Hockey Weekly Planner: Google Sheet backup.
 *
 * Setup (once):
 *  1. Create a new Google Sheet. Extensions > Apps Script. Replace the sample code with this file.
 *  2. Change KEY below to your own secret word (letters and numbers only).
 *  3. Deploy > New deployment > type "Web app". Execute as: Me. Who has access: Anyone.
 *  4. Copy the web app URL, add ?key=YOUR_SECRET to the end, and paste it into the planner's Backup tab.
 *
 * The planner writes three readable tabs (Summary, Schedule, and a raw Data tab used for restore),
 * plus one snapshot per day for the last 14 days in case a bad save needs undoing.
 */
const KEY = 'change-me';
const CHUNK = 40000; // a Sheets cell holds at most 50,000 characters

function doPost(e) {
  return respond(function () {
    checkKey(e);
    const payload = JSON.parse(e.postData.contents);
    if (!payload || !payload.state || !payload.state.weeks) throw new Error('No planner data in the request');
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const json = JSON.stringify(payload.state);
      const savedAt = payload.savedAt || new Date().toISOString();

      writeTable(ss, 'Summary',
        ['Week of', 'Cello', 'Math', 'Writing', 'Reading', 'Chores', 'Hockey sessions', 'Hockey minutes', 'Shots', 'Full week', 'What went well', 'Change next week'],
        payload.summary || []);
      writeTable(ss, 'Schedule',
        ['Week of', 'Day', 'Date', 'When', 'Type', 'Item', 'Minutes', 'Done', 'Drills', 'Shots'],
        payload.schedule || []);

      const data = sheet(ss, 'Data (do not edit)');
      data.clearContents();
      const parts = chunk(json);
      data.getRange(1, 1, 1, 2).setValues([['Saved at', savedAt]]);
      data.getRange(2, 1, parts.length, 1).setValues(parts.map(function (p) { return [p]; }));

      snapshot(ss, savedAt, parts);
      return { ok: true, savedAt: savedAt };
    } finally {
      lock.releaseLock();
    }
  });
}

function doGet(e) {
  return respond(function () {
    checkKey(e);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const data = ss.getSheetByName('Data (do not edit)');
    if (!data || data.getLastRow() < 2) return { ok: true, state: null };
    const savedAt = data.getRange(1, 2).getValue();
    const json = data.getRange(2, 1, data.getLastRow() - 1, 1).getValues().map(function (r) { return r[0]; }).join('');
    return { ok: true, savedAt: String(savedAt), state: JSON.parse(json) };
  });
}

function checkKey(e) {
  if (KEY === 'change-me') throw new Error('Set your own KEY in the script first');
  if (!e || !e.parameter || e.parameter.key !== KEY) throw new Error('Wrong key');
}

function respond(fn) {
  var out;
  try { out = fn(); } catch (err) { out = { ok: false, error: String(err && err.message || err) }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function sheet(ss, name) { return ss.getSheetByName(name) || ss.insertSheet(name); }

function chunk(s) {
  const out = [];
  for (var i = 0; i < s.length; i += CHUNK) out.push(s.slice(i, i + CHUNK));
  return out.length ? out : [''];
}

function writeTable(ss, name, header, rows) {
  const sh = sheet(ss, name);
  sh.clearContents();
  // Plain text keeps "2/4" from being turned into a date.
  const all = [header].concat(rows);
  const range = sh.getRange(1, 1, all.length, header.length);
  range.setNumberFormat('@');
  range.setValues(all.map(function (r) {
    const row = r.slice(0, header.length);
    while (row.length < header.length) row.push('');
    return row.map(function (v) { return v === null || v === undefined ? '' : String(v); });
  }));
  sh.getRange(1, 1, 1, header.length).setFontWeight('bold');
  sh.setFrozenRows(1);
}

function snapshot(ss, savedAt, parts) {
  const sh = sheet(ss, 'Daily snapshots');
  const day = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const last = sh.getLastRow();
  const days = last ? sh.getRange(1, 1, last, 1).getDisplayValues().map(function (r) { return r[0]; }) : [];
  var row = days.indexOf(day) + 1;
  if (!row) row = last + 1;
  const width = Math.max(sh.getLastColumn(), parts.length + 2);
  const values = [day, savedAt].concat(parts);
  while (values.length < width) values.push('');
  sh.getRange(row, 1, 1, width).setNumberFormat('@').setValues([values]);
  const extra = sh.getLastRow() - 14;
  if (extra > 0) sh.deleteRows(1, extra);
}
