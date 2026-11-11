# Hockey Weekly Planner

A one-page planner for a 10U hockey player: schedule the week, pick off-ice drills, check things off, and watch progress build.

- **My Week**: Monday-to-Sunday view with Morning, Afternoon and Evening rows. Reading, Monday practice, Saturday game and Sunday chores are pre-filled. Tap **+ Add** to schedule cello, math, writing, hockey training or anything else. Tap the circle to mark an item done.
- **Drills**: 67 cards in three groups (Puck & Ball, Athlete, Hockey IQ) with steps, a coach's cue, three levels, diagrams and quiz questions. Content follows USA Hockey's American Development Model guidance for 10U.
- **Progress**: weekly bars, full-week streak, shot counter, personal bests and badges.
- **Backup**: optional automatic copy to a Google Sheet, plus export and import of a backup file.

## Hosting (GitHub Pages)

Settings > Pages > Source: **Deploy from a branch**, branch **main**, folder **/ (root)**. The site appears at `https://<user>.github.io/hockey-weekly-planner/`. On the iPad, open it in Safari and choose Share > Add to Home Screen.

## Google Sheet backup (one-time, about five minutes)

1. Create a new Google Sheet, then open Extensions > Apps Script.
2. Replace the sample code with the contents of [`backup/Code.gs`](backup/Code.gs).
3. Change `KEY` near the top to your own secret word (letters and numbers).
4. Deploy > New deployment > type **Web app**. Execute as **Me**; who has access: **Anyone**. Approve the permission prompt.
5. Copy the web app URL, add `?key=YOUR_SECRET` to the end, and paste it into the planner's **Backup** tab. Tap **Save link and test**.

The Sheet gets a `Summary` tab (one row per week), a `Schedule` tab (one row per item), a raw data tab used for restore, and daily snapshots for the last 14 days. If the iPad's data is ever cleared, paste the link again and the planner offers to restore.

## Changing the weekly minimums

Edit `SUBJECTS` at the top of `app.js` (for example `cello: { mins: 15, min: 4 }`). Fixed weekly items are in `seedWeek()`; changes apply to weeks that have not been opened yet.

## Files

`index.html`, `styles.css`, `app.js` (the app), `drills.js` (drill content), `sw.js` and `manifest.webmanifest` (offline and Home Screen support), `backup/Code.gs` (Google Apps Script).
