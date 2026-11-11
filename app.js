'use strict';

/* ───────── Configuration: weekly minimums live here ───────── */
const SUBJECTS = {
  cello:   { label: 'Cello',           mins: 15, min: 4 },
  math:    { label: 'Math',            mins: 20, min: 3 },
  writing: { label: 'Writing',         mins: 30, min: 1 },
  reading: { label: 'Reading',         mins: 30, min: 7 },
  chore:   { label: 'Chores' },
  hockey:  { label: 'Hockey training', mins: 20 },
  team:    { label: 'Team hockey' },
  other:   { label: 'Other' },
};
const METERS = ['cello', 'math', 'writing', 'reading', 'chore'];
const PLANNABLE = ['cello', 'math', 'writing'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SLOTS = { am: 'Morning', pm: 'Afternoon', eve: 'Evening' };
const SHOT_GOALS = [500, 1000, 2500, 5000, 10000];
const STORE_KEY = 'hwp-v1';
const META_KEY = 'hwp-meta';
const DRILL_BY_ID = Object.fromEntries(DRILLS.map((d) => [d.id, d]));
const AUTO_SKIP = /partner|rebounder|pvc|jump rope|ladder|tennis/i;

/* ───────── Dates ───────── */
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
function mondayKey(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return iso(x);
}
function addDays(key, n) { const d = parseKey(key); d.setDate(d.getDate() + n); return iso(d); }
const shortDate = (key) => { const d = parseKey(key); return `${MONTHS[d.getMonth()]} ${d.getDate()}`; };
const thisWeek = () => mondayKey(new Date());
const todayIndex = () => (new Date().getDay() + 6) % 7;

/* ───────── State ───────── */
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function freshState() { return { version: 1, weeks: {}, drill: {}, settings: { backupUrl: '' }, updatedAt: 0 }; }
function validState(s) { return s && typeof s === 'object' && s.weeks && typeof s.weeks === 'object'; }
function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (validState(s)) { s.drill = s.drill || {}; s.settings = s.settings || { backupUrl: '' }; return s; }
  } catch (e) { /* fall through to a fresh state */ }
  return freshState();
}
function loadMeta() { try { return JSON.parse(localStorage.getItem(META_KEY)) || {}; } catch (e) { return {}; } }

let state = loadState();
let meta = loadMeta();
const ui = { tab: 'week', weekKey: thisWeek(), cat: 'puck', sub: 'All', sheet: null, pick: null };

function persist() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { toast('Could not save. Storage may be full.'); }
}
function save() { state.updatedAt = Date.now(); persist(); queueBackup(); }
function saveMeta() { try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch (e) { /* not critical */ } }

function seedWeek() {
  const items = [];
  const add = (o) => items.push({ id: uid(), done: false, fixed: true, ...o });
  add({ type: 'team', title: 'Hockey practice', day: 0, slot: 'eve' });
  add({ type: 'team', title: 'Hockey game', day: 5, slot: 'am', game: true });
  for (let d = 0; d < 7; d++) add({ type: 'reading', title: 'Reading', mins: 30, day: d, slot: 'eve' });
  ['Laundry', 'Clean room', 'Take out trash'].forEach((t) => add({ type: 'chore', title: t, day: 6, slot: 'pm' }));
  return { items, review: { good: '', change: '' } };
}
function getWeek(key) {
  if (!state.weeks[key]) state.weeks[key] = seedWeek();
  const w = state.weeks[key];
  w.review = w.review || { good: '', change: '' };
  return w;
}
const findItem = (key, id) => getWeek(key).items.find((i) => i.id === id);

/* ───────── Stats ───────── */
function weekStats(w) {
  const s = { hockey: { done: 0, planned: 0, mins: 0, shots: 0 } };
  METERS.forEach((t) => { s[t] = { done: 0, planned: 0 }; });
  for (const it of w.items) {
    if (it.type === 'hockey') {
      s.hockey.planned++;
      s.hockey.shots += it.shots || 0;
      if (it.done) { s.hockey.done++; s.hockey.mins += it.mins || 0; }
    } else if (s[it.type]) {
      s[it.type].planned++;
      if (it.done) s[it.type].done++;
    }
  }
  METERS.forEach((t) => { s[t].target = t === 'chore' ? s.chore.planned : SUBJECTS[t].min; });
  s.full = METERS.every((t) => s[t].done >= s[t].target);
  return s;
}

function allStats() {
  const now = thisWeek();
  const keys = Object.keys(state.weeks).filter((k) => k <= now).sort();
  const tried = {};
  let sessions = 0, mins = 0, shots = 0, balanced = false, fullWeeks = 0;
  const fullSet = new Set();
  for (const k of keys) {
    const w = state.weeks[k];
    const cats = new Set();
    for (const it of w.items) {
      if (it.type !== 'hockey') continue;
      shots += it.shots || 0;
      if (!it.done) continue;
      sessions++; mins += it.mins || 0;
      for (const id of it.drills || []) {
        if (!DRILL_BY_ID[id]) continue;
        tried[id] = (tried[id] || 0) + 1;
        cats.add(DRILL_BY_ID[id].cat);
      }
    }
    if (cats.size === 3) balanced = true;
    if (weekStats(w).full) { fullWeeks++; fullSet.add(k); }
  }
  let quizzes = 0, bests = 0, lvl3 = false;
  for (const [id, d] of Object.entries(state.drill)) {
    if (!DRILL_BY_ID[id]) continue;
    if (d.quiz) { quizzes++; tried[id] = (tried[id] || 0) + 1; }
    if (d.best != null) bests++;
    if (d.level === 3) lvl3 = true;
  }
  // Streak: full weeks in a row, ending at this week (or last week if this one is still in progress).
  let streak = 0, k = now;
  if (!fullSet.has(k)) k = addDays(k, -7);
  while (fullSet.has(k)) { streak++; k = addDays(k, -7); }
  let best = 0, run = 0, prev = null;
  for (const wk of [...fullSet].sort()) {
    run = prev && addDays(prev, 7) === wk ? run + 1 : 1;
    best = Math.max(best, run); prev = wk;
  }
  const byCat = { puck: 0, athlete: 0, iq: 0 };
  for (const [id, n] of Object.entries(tried)) byCat[DRILL_BY_ID[id].cat] += n;
  return { tried, triedCount: Object.keys(tried).length, sessions, mins, shots, balanced, fullWeeks, streak, bestStreak: best, quizzes, bests, lvl3, byCat, keys };
}

function badges(st) {
  return [
    ['First Shift', 'Finish your first training session', st.sessions >= 1],
    ['10 Sessions', 'Finish 10 training sessions', st.sessions >= 10],
    ['25 Sessions', 'Finish 25 training sessions', st.sessions >= 25],
    ['50 Sessions', 'Finish 50 training sessions', st.sessions >= 50],
    ['Explorer', 'Try 10 different drills', st.triedCount >= 10],
    ['Deep Bench', 'Try 30 different drills', st.triedCount >= 30],
    ['Balanced Week', 'Puck, Athlete and Hockey IQ in one week', st.balanced],
    ['500 Shots', 'Log 500 shots', st.shots >= 500],
    ['1,000 Shots', 'Log 1,000 shots', st.shots >= 1000],
    ['2,500 Shots', 'Log 2,500 shots', st.shots >= 2500],
    ['5,000 Shots', 'Log 5,000 shots', st.shots >= 5000],
    ['Full Week', 'Fill every bar in one week', st.fullWeeks >= 1],
    ['Four in a Row', 'Four full weeks in a row', st.bestStreak >= 4],
    ['Student of the Game', 'Answer 8 Hockey IQ questions correctly', st.quizzes >= 8],
    ['Record Keeper', 'Log a personal best on 5 drills', st.bests >= 5],
    ['Level 3', 'Reach level 3 on any drill', st.lvl3],
  ].map(([name, how, earned]) => ({ name, how, earned }));
}

/* ───────── Diagrams ───────── */
function diagram(spec) {
  if (!spec) return '';
  const defs = '<defs><marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#0b2545"/></marker></defs>';
  const arrows = (spec.arrows || []).map((a) => `<path d="${a.path}" fill="none" stroke="#0b2545" stroke-width="1.6" ${a.dashed ? 'stroke-dasharray="4 3"' : ''} marker-end="url(#arr)"/>`).join('');
  const players = (spec.players || []).map(([x, y, t, team]) => (team === 'us'
    ? `<circle cx="${x}" cy="${y}" r="9" fill="#0b2545"/><text x="${x}" y="${y + 2.8}" class="dg-p" fill="#fff">${t}</text>`
    : `<circle cx="${x}" cy="${y}" r="9" fill="#fff" stroke="#c8102e" stroke-width="1.6"/><text x="${x}" y="${y + 2.8}" class="dg-p" fill="#c8102e">${t}</text>`)).join('');
  const puck = spec.puck ? `<circle cx="${spec.puck[0]}" cy="${spec.puck[1]}" r="3.2" fill="#111"/>` : '';
  const labels = (spec.labels || []).map(([x, y, t]) => `<text x="${x}" y="${y}" class="dg-l">${esc(t)}</text>`).join('');
  const key = spec.players ? '<p class="dg-key"><span class="k-us"></span> your team <span class="k-them"></span> other team <span class="k-puck"></span> puck &nbsp; solid arrow: skate &nbsp; dashed: pass</p>' : '';
  let body = '', vb = '0 0 200 170';
  if (spec.view === 'zone') {
    body = `<path d="M4 166 V40 Q4 6 40 6 H160 Q196 6 196 40 V166" fill="#f6fafd" stroke="#0b2545" stroke-width="2"/>
      ${spec.house ? '<path d="M90 30 L110 30 L142 72 L126 104 L74 104 L58 72 Z" fill="rgba(200,16,46,.10)" stroke="#c8102e" stroke-dasharray="3 3" stroke-width="1"/>' : ''}
      <line x1="11" y1="30" x2="189" y2="30" stroke="#c8102e" stroke-width="1"/>
      <path d="M88 30 A12 12 0 0 0 112 30 Z" fill="#cfe6fa" stroke="#c8102e" stroke-width=".8"/>
      <rect x="92" y="23" width="16" height="7" fill="none" stroke="#0b2545" stroke-width="1.2"/>
      <circle cx="55" cy="70" r="19" fill="none" stroke="#c8102e" stroke-width=".8"/><circle cx="145" cy="70" r="19" fill="none" stroke="#c8102e" stroke-width=".8"/>
      <circle cx="55" cy="70" r="2" fill="#c8102e"/><circle cx="145" cy="70" r="2" fill="#c8102e"/>
      <line x1="4" y1="153" x2="196" y2="153" stroke="#1f5fbf" stroke-width="4"/>`;
  } else if (spec.view === 'full') {
    vb = '0 0 300 130';
    body = `<rect x="4" y="4" width="292" height="122" rx="32" fill="#f6fafd" stroke="#0b2545" stroke-width="2"/>
      <line x1="28" y1="10" x2="28" y2="120" stroke="#c8102e" stroke-width="1"/><line x1="272" y1="10" x2="272" y2="120" stroke="#c8102e" stroke-width="1"/>
      <line x1="110" y1="4" x2="110" y2="126" stroke="#1f5fbf" stroke-width="3.5"/><line x1="190" y1="4" x2="190" y2="126" stroke="#1f5fbf" stroke-width="3.5"/>
      <line x1="150" y1="4" x2="150" y2="126" stroke="#c8102e" stroke-width="3"/>
      <rect x="21" y="58" width="7" height="14" fill="none" stroke="#0b2545" stroke-width="1.2"/><rect x="272" y="58" width="7" height="14" fill="none" stroke="#0b2545" stroke-width="1.2"/>
      <text x="40" y="122" class="dg-l" text-anchor="start">your net</text>`;
  } else {
    vb = '0 0 200 120';
    body = `<rect x="2" y="2" width="196" height="116" rx="8" fill="#f6fafd" stroke="#c9d6e2" stroke-width="1.5"/>`
      + (spec.cones || []).map(([x, y]) => `<path d="M${x} ${y - 7} L${x + 6} ${y + 5} L${x - 6} ${y + 5} Z" fill="#f08a24"/>`).join('')
      + (spec.you ? `<circle cx="${spec.you[0]}" cy="${spec.you[1]}" r="8" fill="#0b2545"/><text x="${spec.you[0]}" y="${spec.you[1] + 2.6}" class="dg-p" fill="#fff">You</text>` : '');
  }
  return `<figure class="dg"><svg viewBox="${vb}" role="img" aria-label="Diagram">${defs}${body}${arrows}${players}${puck}${labels}</svg>${key}</figure>`;
}

/* ───────── Rendering ───────── */
const $ = (sel) => document.querySelector(sel);

function render() {
  $('#top').innerHTML = renderTop();
  $('#main').innerHTML = { week: renderWeek, drills: renderDrills, progress: renderProgress, settings: renderSettings }[ui.tab]();
  $('#tabs').innerHTML = [['week', 'My Week'], ['drills', 'Drills'], ['progress', 'Progress'], ['settings', 'Backup']]
    .map(([t, l]) => `<button data-a="tab" data-tab="${t}" class="${ui.tab === t ? 'on' : ''}" ${ui.tab === t ? 'aria-current="page"' : ''}>${l}</button>`).join('');
  renderSheet();
}

function renderTop() {
  const st = allStats();
  return `<div class="brand"><span class="logo" aria-hidden="true"></span>Hockey Weekly Planner</div>
    <div class="streak" title="Full weeks in a row">${st.streak > 0 ? `<b>${st.streak}</b> week streak` : 'Fill every bar to start a streak'}</div>`;
}

function meter(type, s) {
  const { done, target } = s[type];
  const pct = target ? Math.min(100, Math.round((done / target) * 100)) : 0;
  const full = target > 0 && done >= target;
  return `<div class="meter t-${type} ${full ? 'full' : ''}">
    <div class="m-top"><span>${SUBJECTS[type].label}</span><b>${done}/${target}${full ? ' ✓' : ''}</b></div>
    <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="${target}" aria-valuenow="${done}" aria-label="${SUBJECTS[type].label}"><i style="width:${pct}%"></i></div>
  </div>`;
}
function meters(s) {
  return `<section class="meters">${METERS.map((t) => meter(t, s)).join('')}
    <div class="meter t-hockey"><div class="m-top"><span>Hockey</span><b>${s.hockey.done} done</b></div>
    <div class="m-sub">${s.hockey.planned} planned · ${s.hockey.mins} min${s.hockey.shots ? ` · ${s.hockey.shots} shots` : ''}</div></div></section>`;
}

function itemMeta(it) {
  const bits = [];
  if (it.mins) bits.push(`${it.mins} min`);
  if (it.type === 'hockey') {
    const n = (it.drills || []).length;
    bits.push(n ? `${n} drill${n === 1 ? '' : 's'}` : 'tap to pick drills');
    if (it.shots) bits.push(`${it.shots} shots`);
  }
  return bits.join(' · ');
}
function itemRow(it) {
  return `<div class="item t-${it.type} ${it.done ? 'done' : ''}">
    <button class="check" data-a="toggle" data-id="${it.id}" aria-pressed="${it.done}" aria-label="${it.done ? 'Mark not done' : 'Mark done'}: ${esc(it.title)}"></button>
    <button class="body" data-a="open" data-id="${it.id}"><span class="ttl">${esc(it.title)}</span><span class="meta">${itemMeta(it)}</span></button>
  </div>`;
}

function renderWeek() {
  const key = ui.weekKey, w = getWeek(key), s = weekStats(w), now = thisWeek();
  const toPlan = PLANNABLE.map((t) => [t, SUBJECTS[t].min - s[t].planned]).filter(([, n]) => n > 0)
    .map(([t, n]) => `${SUBJECTS[t].label} ×${n}`);
  const prev = state.weeks[addDays(key, -7)];
  const canCopy = !w.items.some((i) => !i.fixed) && prev && prev.items.some((i) => !i.fixed);
  const order = (slot) => (a, b) => (slot === 'eve' ? (a.type === 'reading') - (b.type === 'reading') : 0);

  const days = DAYS.map((d, i) => {
    const dayItems = w.items.filter((it) => it.day === i);
    const game = dayItems.some((it) => it.game);
    const slots = ['am', 'pm', 'eve'].map((slot) => {
      const list = dayItems.filter((it) => it.slot === slot).sort(order(slot));
      if (slot === 'eve' && !list.length) return '';
      return `<div class="slot s-${slot}"><h3>${SLOTS[slot]}</h3>${list.map(itemRow).join('')}
        ${slot === 'eve' ? '' : `<button class="add" data-a="add" data-day="${i}" data-slot="${slot}" aria-label="Add to ${DAYS_LONG[i]} ${SLOTS[slot].toLowerCase()}">+ Add</button>`}</div>`;
    }).join('');
    const left = dayItems.filter((it) => !it.done).length;
    return `<article class="day ${key === now && i === todayIndex() ? 'today' : ''}">
      <header><h2>${DAYS_LONG[i]}</h2><span>${shortDate(addDays(key, i))}${dayItems.length && !left ? ' · all done' : ''}</span></header>
      ${game ? '<p class="gamenote">Game day. Keep off-ice work light.</p>' : ''}${slots}</article>`;
  }).join('');

  return `<section class="weekbar">
      <button class="nav" data-a="week" data-step="-1" aria-label="Previous week">‹</button>
      <div><h1>Week of ${shortDate(key)}</h1><p>${key === now ? 'This week' : key < now ? 'Past week' : 'Upcoming week'}${key !== now ? ' · <button class="link" data-a="week" data-step="0">Go to this week</button>' : ''}</p></div>
      <button class="nav" data-a="week" data-step="1" aria-label="Next week">›</button>
    </section>
    ${meters(s)}
    ${toPlan.length ? `<p class="toplan"><b>Still to plan:</b> ${toPlan.join(' · ')}</p>` : '<p class="toplan ok">All minimums are on the schedule.</p>'}
    ${canCopy ? '<button class="btn ghost wide" data-a="copyweek">Copy last week\'s plan</button>' : ''}
    <section class="days">${days}</section>
    <section class="review"><h2>Week review</h2>
      <label>What went well?<textarea data-f="review" data-k="good" rows="2">${esc(w.review.good)}</textarea></label>
      <label>What will I change next week?<textarea data-f="review" data-k="change" rows="2">${esc(w.review.change)}</textarea></label>
    </section>`;
}

function renderDrills() {
  const st = allStats();
  const inCat = DRILLS.filter((d) => d.cat === ui.cat);
  const subs = ['All', ...new Set(inCat.map((d) => d.sub))];
  if (!subs.includes(ui.sub)) ui.sub = 'All';
  const list = inCat.filter((d) => ui.sub === 'All' || d.sub === ui.sub);
  const pickItem = ui.pick && findItem(ui.pick.weekKey, ui.pick.id);
  const chosen = pickItem ? pickItem.drills || [] : [];
  const cards = list.map((d) => {
    const n = st.tried[d.id] || 0, lvl = (state.drill[d.id] || {}).level || 1;
    return `<div class="card c-${d.cat}">
      <button class="cardbody" data-a="drill" data-id="${d.id}">
        <span class="tag">${esc(d.sub)}</span><span class="ttl">${esc(d.title)}</span>
        <span class="meta">${d.mins} min · Level ${lvl}${n ? ` · done ${n}×` : ''}</span>
      </button>
      ${pickItem ? `<button class="pick ${chosen.includes(d.id) ? 'on' : ''}" data-a="pickdrill" data-id="${d.id}" aria-pressed="${chosen.includes(d.id)}">${chosen.includes(d.id) ? '✓ Added' : '+ Add'}</button>` : ''}
    </div>`;
  }).join('');
  return `${pickItem ? `<div class="pickbar"><span>Choosing drills for <b>${DAYS_LONG[pickItem.day]} ${SLOTS[pickItem.slot].toLowerCase()}</b> · ${chosen.length} chosen</span><button class="btn" data-a="pickdone">Done</button></div>` : ''}
    <div class="seg" role="tablist">${Object.entries(CATS).map(([k, c]) => `<button role="tab" aria-selected="${ui.cat === k}" class="${ui.cat === k ? 'on' : ''}" data-a="cat" data-cat="${k}">${c.label}</button>`).join('')}</div>
    <p class="blurb">${CATS[ui.cat].blurb}</p>
    <div class="chips">${subs.map((s) => `<button class="chip ${ui.sub === s ? 'on' : ''}" data-a="sub" data-sub="${esc(s)}">${esc(s)}</button>`).join('')}</div>
    <section class="cards">${cards}</section>
    <p class="fine">Drills follow USA Hockey's 10U guidance: mostly skills, plenty of athletic variety, and a little hockey sense. More at <a href="https://www.usahockey.com/dryland" target="_blank" rel="noopener">usahockey.com/dryland</a>.</p>`;
}

function renderProgress() {
  const st = allStats(), s = weekStats(getWeek(thisWeek()));
  const next = SHOT_GOALS.find((g) => g > st.shots) || SHOT_GOALS[SHOT_GOALS.length - 1];
  const totalCat = Math.max(1, st.byCat.puck + st.byCat.athlete + st.byCat.iq);
  const bests = DRILLS.filter((d) => d.measure && (state.drill[d.id] || {}).best != null)
    .map((d) => `<li><span>${esc(d.measure.label)}</span><b>${state.drill[d.id].best} ${esc(d.measure.unit)}</b></li>`).join('');
  const recent = st.keys.slice(-8).reverse().map((k) => {
    const ws = weekStats(state.weeks[k]);
    return `<tr><th scope="row">${shortDate(k)}</th>${METERS.map((t) => `<td class="${ws[t].done >= ws[t].target ? 'yes' : ''}">${ws[t].done}/${ws[t].target}</td>`).join('')}<td>${ws.hockey.done}</td><td>${ws.full ? '★' : ''}</td></tr>`;
  }).join('');
  return `<section class="statrow">
      <div class="stat big"><b>${st.streak}</b><span>full weeks in a row</span><small>Best: ${st.bestStreak}</small></div>
      <div class="stat"><b>${st.sessions}</b><span>training sessions</span></div>
      <div class="stat"><b>${st.mins}</b><span>minutes trained</span></div>
      <div class="stat"><b>${st.triedCount}<small>/${DRILLS.length}</small></b><span>drills tried</span></div>
    </section>
    <h2>This week</h2>${meters(s)}
    <h2>Shot counter</h2>
    <section class="panel"><div class="m-top"><span>${st.shots.toLocaleString()} shots logged</span><b>Next goal: ${next.toLocaleString()}</b></div>
      <div class="bar tall"><i style="width:${Math.min(100, (st.shots / next) * 100)}%"></i></div>
      <p class="fine">Add shots inside any hockey training session on My Week.</p></section>
    <h2>Training balance</h2>
    <section class="panel">${Object.entries(CATS).map(([k, c]) => `<div class="balrow"><span>${c.label}</span><div class="bar c-${k}"><i style="width:${(st.byCat[k] / totalCat) * 100}%"></i></div><b>${st.byCat[k]}</b></div>`).join('')}
      <p class="fine">Aim for mostly Puck & Ball, a steady amount of Athlete work, and a little Hockey IQ each week.</p></section>
    <h2>Personal bests</h2>
    <section class="panel">${bests ? `<ul class="bests">${bests}</ul>` : '<p class="fine">Open a drill with a score, like Four Corners or Figure 8s, and log your result.</p>'}</section>
    <h2>Badges</h2>
    <section class="badges">${badges(st).map((b) => `<div class="badge ${b.earned ? 'earned' : ''}"><span class="star" aria-hidden="true">★</span><b>${b.name}</b><small>${b.how}</small></div>`).join('')}</section>
    <h2>Recent weeks</h2>
    <section class="panel scroll"><table><thead><tr><th>Week</th>${METERS.map((t) => `<th>${SUBJECTS[t].label}</th>`).join('')}<th>Hockey</th><th>Full</th></tr></thead><tbody>${recent}</tbody></table></section>`;
}

function renderSettings() {
  const url = state.settings.backupUrl || '';
  const last = meta.lastBackup ? new Date(meta.lastBackup).toLocaleString() : 'never';
  return `<h1>Backup</h1>
    <section class="panel"><h2>Google Sheet backup</h2>
      <p>Your plan is saved on this iPad. If a parent has set up the Google Sheet, paste its web app link here and the planner will save a copy after every change.</p>
      <label>Web app link<input type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" id="backupUrl" value="${esc(url)}" placeholder="https://script.google.com/macros/s/…/exec?key=…"></label>
      <div class="row"><button class="btn" data-a="saveurl">Save link and test</button>
        <button class="btn ghost" data-a="backupnow" ${url ? '' : 'disabled'}>Back up now</button>
        <button class="btn ghost" data-a="askrestore" ${url ? '' : 'disabled'}>Restore from Sheet</button></div>
      <p class="fine" id="backupStatus">Last backup: ${last}${meta.backupError ? ` · Last error: ${esc(meta.backupError)}` : ''}</p></section>
    <section class="panel"><h2>File backup</h2>
      <p>Save a copy to the Files app, or load one back in.</p>
      <div class="row"><button class="btn ghost" data-a="export">Export a backup file</button>
        <label class="btn ghost filebtn">Import a backup file<input type="file" accept="application/json,.json" data-f="import"></label></div></section>
    <section class="panel"><h2>Tips</h2>
      <p>Add this page to the Home Screen (Share, then Add to Home Screen) so it opens like an app and works without internet.</p>
      <p class="fine">Hockey Weekly Planner · drills written for 10U players using USA Hockey's American Development Model as a guide.</p></section>`;
}

/* ───────── Sheets (pop-up panels) ───────── */
function renderSheet() {
  const el = $('#sheet');
  if (!ui.sheet) { el.hidden = true; el.innerHTML = ''; document.body.classList.remove('locked'); return; }
  const html = { add: sheetAdd, item: sheetItem, drill: sheetDrill, place: sheetPlace, confirm: sheetConfirm }[ui.sheet.kind](ui.sheet);
  if (!html) { ui.sheet = null; return renderSheet(); }
  el.hidden = false; document.body.classList.add('locked');
  el.innerHTML = `<div class="backdrop" data-a="close"></div><div class="panelsheet" role="dialog" aria-modal="true"><button class="x" data-a="close" aria-label="Close">×</button>${html}</div>`;
}

function sheetAdd({ day, slot }) {
  const s = weekStats(getWeek(ui.weekKey));
  const quick = PLANNABLE.map((t) => {
    const left = SUBJECTS[t].min - s[t].planned;
    return `<button class="opt t-${t}" data-a="addtype" data-type="${t}"><b>${SUBJECTS[t].label}</b><span>${SUBJECTS[t].mins} min · ${left > 0 ? `${left} more to plan` : 'minimum already planned'}</span></button>`;
  }).join('');
  return `<h2>Add to ${DAYS_LONG[day]} ${SLOTS[slot].toLowerCase()}</h2>
    <div class="opts">${quick}</div>
    <h3>Hockey training</h3>
    <div class="row">${[15, 20, 30].map((m) => `<button class="btn hockey" data-a="addtype" data-type="hockey" data-mins="${m}">${m} min</button>`).join('')}</div>
    <h3>Something else</h3>
    <label class="sr" for="otherTitle">Name</label><input id="otherTitle" type="text" maxlength="60" placeholder="Piano recital, mow the lawn, Scouts…">
    <div class="row"><button class="btn ghost" data-a="addother" data-type="other">Add as activity</button><button class="btn ghost" data-a="addother" data-type="chore">Add as chore</button></div>`;
}

function chipRow(action, opts, current, extra = '') {
  return `<div class="chips">${opts.map(([v, l]) => `<button class="chip ${String(v) === String(current) ? 'on' : ''}" data-a="${action}" data-v="${v}" ${extra}>${l}</button>`).join('')}</div>`;
}

function sheetItem({ id }) {
  const it = findItem(ui.weekKey, id);
  if (!it) return '';
  const slotOpts = Object.entries(SLOTS).filter(([k]) => k !== 'eve' || it.fixed || it.slot === 'eve');
  let hockey = '';
  if (it.type === 'hockey') {
    const drills = (it.drills || []).map((d) => DRILL_BY_ID[d]).filter(Boolean);
    const total = drills.reduce((a, d) => a + d.mins, 0);
    hockey = `<h3>Length</h3>${chipRow('setmins', [15, 20, 30, 45].map((m) => [m, `${m} min`]), it.mins)}
      <h3>Drills${drills.length ? ` <small>about ${total} min</small>` : ''}</h3>
      ${drills.length ? `<ul class="drilllist">${drills.map((d) => `<li class="c-${d.cat}"><button class="link" data-a="drill" data-id="${d.id}" data-back="${it.id}">${esc(d.title)}</button><span>${d.mins} min</span><button class="rm" data-a="rmdrill" data-id="${d.id}" aria-label="Remove ${esc(d.title)}">×</button></li>`).join('')}</ul>` : '<p class="fine">No drills yet. Choose your own or let the planner build a balanced session.</p>'}
      <div class="row"><button class="btn" data-a="pickstart">Choose drills</button><button class="btn ghost" data-a="autobuild">Build one for me</button></div>
      <h3>Shots taken</h3>
      <div class="row shots"><button class="btn ghost" data-a="shots" data-n="-10">−10</button><input type="number" inputmode="numeric" min="0" step="1" data-f="shots" value="${it.shots || 0}" aria-label="Shots taken"><button class="btn ghost" data-a="shots" data-n="10">+10</button><button class="btn ghost" data-a="shots" data-n="25">+25</button></div>`;
  }
  return `<p class="tag t-${it.type}">${SUBJECTS[it.type].label}</p><h2>${esc(it.title)}</h2>
    <button class="btn wide ${it.done ? 'ghost' : ''}" data-a="toggle" data-id="${it.id}">${it.done ? 'Done ✓ (tap to undo)' : 'Mark as done'}</button>
    ${hockey}
    <h3>Day</h3>${chipRow('setday', DAYS.map((d, i) => [i, d]), it.day)}
    <h3>Time</h3>${chipRow('setslot', slotOpts, it.slot)}
    <button class="btn danger wide" data-a="delete">Remove from this week</button>`;
}

function sheetDrill({ id, quizPick, corner }) {
  const d = DRILL_BY_ID[id];
  if (!d) return '';
  const rec = state.drill[id] || {};
  const lvl = rec.level || 1;
  const isIq = d.cat === 'iq';
  let quiz = '';
  if (d.quiz) {
    const answered = quizPick != null;
    quiz = `<h3>What would you do?</h3><p>${esc(d.quiz.q)}</p><div class="opts quiz">${d.quiz.options.map((o, i) => {
      const cls = answered ? (i === d.quiz.answer ? 'right' : i === quizPick ? 'wrong' : '') : '';
      return `<button class="opt ${cls}" data-a="quiz" data-i="${i}" ${answered ? 'disabled' : ''}>${esc(o)}</button>`;
    }).join('')}</div>
    ${answered ? `<p class="why ${quizPick === d.quiz.answer ? 'good' : ''}"><b>${quizPick === d.quiz.answer ? 'Correct.' : 'Not quite.'}</b> ${esc(d.quiz.why)} ${quizPick === d.quiz.answer ? '' : '<button class="link" data-a="quizretry">Try again</button>'}</p>` : rec.quiz ? '<p class="fine">You have answered this one correctly before.</p>' : ''}`;
  }
  const measure = d.measure ? `<h3>Personal best</h3><p>${esc(d.measure.label)}: <b>${rec.best != null ? `${rec.best} ${esc(d.measure.unit)}` : 'not logged yet'}</b></p>
    <div class="row"><input type="number" inputmode="decimal" min="0" step="any" id="scoreInput" placeholder="Today's result" aria-label="Today's result"><button class="btn ghost" data-a="score">Log it</button></div>` : '';
  return `<p class="tag c-${d.cat}">${CATS[d.cat].label} · ${esc(d.sub)}</p><h2>${esc(d.title)}</h2>
    <p class="meta">${d.mins} min${d.gear.length ? ` · You need: ${d.gear.map(esc).join(', ')}` : ''}</p>
    <p class="lead">${esc(d.why)}</p>
    ${diagram(d.diagram)}
    <h3>${isIq ? 'Key ideas' : 'How to do it'}</h3><ol class="${isIq ? 'ideas' : ''}">${d.how.map((h) => `<li>${esc(h)}</li>`).join('')}</ol>
    <p class="cue"><b>Coach's cue</b> ${esc(d.cue)}</p>
    ${d.safety ? `<p class="safety"><b>Safety</b> ${esc(d.safety)}</p>` : ''}
    ${d.id === 'sht-targets' ? `<div class="row"><button class="btn ghost" data-a="corner">Call a corner</button>${corner ? `<b class="corner">${corner}</b>` : ''}</div>` : ''}
    <h3>${isIq ? 'Take it further' : 'Levels'} <small>tap the one you are working on</small></h3>
    <div class="levels">${d.levels.map((l, i) => `<button class="lvl ${lvl === i + 1 ? 'on' : ''}" data-a="level" data-v="${i + 1}"><b>${i + 1}</b><span>${esc(l)}</span></button>`).join('')}</div>
    ${measure}${quiz}
    ${d.watch ? `<p class="cue"><b>Watch for it</b> ${esc(d.watch)}</p>` : ''}
    <button class="btn wide" data-a="placestart" data-id="${d.id}">Add to my week</button>`;
}

function sheetPlace({ id }) {
  const d = DRILL_BY_ID[id], w = getWeek(ui.weekKey);
  const rows = DAYS.map((day, i) => `<div class="placerow"><span>${day} <small>${shortDate(addDays(ui.weekKey, i))}</small></span>${['am', 'pm'].map((slot) => {
    const has = w.items.some((it) => it.type === 'hockey' && it.day === i && it.slot === slot);
    return `<button class="chip ${has ? 'has' : ''}" data-a="place" data-day="${i}" data-slot="${slot}">${SLOTS[slot]}${has ? ' · add to session' : ''}</button>`;
  }).join('')}</div>`).join('');
  return `<h2>Add "${esc(d.title)}"</h2><p class="meta">Week of ${shortDate(ui.weekKey)}. Pick a day and time.</p>${rows}`;
}

function sheetConfirm({ title, text, yes, action }) {
  return `<h2>${esc(title)}</h2><p>${esc(text)}</p><div class="row"><button class="btn danger" data-a="${action}">${esc(yes)}</button><button class="btn ghost" data-a="close">Cancel</button></div>`;
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

/* ───────── Session builder ───────── */
function buildSession(mins) {
  const st = allStats();
  const pool = (cat) => DRILLS.filter((d) => d.cat === cat && d.sub !== 'Warm-up & Mobility' && !d.gear.some((g) => AUTO_SKIP.test(g)));
  const pickFrom = (cat, n, used) => {
    const out = [];
    const cands = pool(cat).filter((d) => !used.includes(d.id))
      .map((d) => ({ d, r: (st.tried[d.id] || 0) + Math.random() * 1.5 })).sort((a, b) => a.r - b.r);
    const subs = new Set();
    for (const { d } of cands) {
      if (out.length >= n) break;
      if (subs.has(d.sub) && cands.length > n) continue;
      subs.add(d.sub); out.push(d.id);
    }
    return out;
  };
  const plan = mins <= 15 ? { puck: 1, athlete: 1, iq: 0 } : mins <= 20 ? { puck: 2, athlete: 1, iq: 0 } : mins <= 30 ? { puck: 2, athlete: 2, iq: 1 } : { puck: 3, athlete: 3, iq: 1 };
  const ids = ['at-warmup'];
  for (const cat of ['puck', 'athlete', 'iq']) ids.push(...pickFrom(cat, plan[cat], ids));
  return ids;
}

/* ───────── Actions ───────── */
const A = {
  tab(d) { ui.tab = d.tab; if (d.tab !== 'drills') ui.pick = null; ui.sheet = null; render(); window.scrollTo(0, 0); },
  close() { ui.sheet = null; renderSheet(); },
  week(d) { const step = Number(d.step); ui.weekKey = step === 0 ? thisWeek() : addDays(ui.weekKey, step * 7); render(); },
  copyweek() {
    const w = getWeek(ui.weekKey), prev = state.weeks[addDays(ui.weekKey, -7)];
    prev.items.filter((i) => !i.fixed).forEach((i) => w.items.push({ ...i, id: uid(), done: false, shots: 0, drills: [...(i.drills || [])] }));
    save(); render(); toast('Copied last week\'s plan. Adjust anything that changed.');
  },
  toggle(d) {
    const it = findItem(ui.weekKey, d.id); if (!it) return;
    it.done = !it.done; save(); render();
    if (it.done && weekStats(getWeek(ui.weekKey)).full) toast('Every bar is full. That is a full week!');
  },
  open(d) { ui.sheet = { kind: 'item', id: d.id }; renderSheet(); },
  add(d) { ui.sheet = { kind: 'add', day: Number(d.day), slot: d.slot }; renderSheet(); },
  addtype(d) {
    const { day, slot } = ui.sheet, t = d.type;
    const it = { id: uid(), type: t, title: SUBJECTS[t].label, mins: Number(d.mins) || SUBJECTS[t].mins, day, slot, done: false };
    if (t === 'hockey') { it.drills = []; it.shots = 0; }
    getWeek(ui.weekKey).items.push(it); save();
    ui.sheet = t === 'hockey' ? { kind: 'item', id: it.id } : null; render();
  },
  addother(d) {
    const title = $('#otherTitle').value.trim();
    if (!title) { toast('Type a name first.'); $('#otherTitle').focus(); return; }
    const { day, slot } = ui.sheet;
    getWeek(ui.weekKey).items.push({ id: uid(), type: d.type, title, day, slot, done: false });
    save(); ui.sheet = null; render();
  },
  setday(d) { const it = findItem(ui.weekKey, ui.sheet.id); it.day = Number(d.v); save(); render(); },
  setslot(d) { const it = findItem(ui.weekKey, ui.sheet.id); it.slot = d.v; save(); render(); },
  setmins(d) { const it = findItem(ui.weekKey, ui.sheet.id); it.mins = Number(d.v); save(); render(); },
  delete() {
    const w = getWeek(ui.weekKey); w.items = w.items.filter((i) => i.id !== ui.sheet.id);
    save(); ui.sheet = null; render(); toast('Removed.');
  },
  shots(d) { const it = findItem(ui.weekKey, ui.sheet.id); it.shots = Math.max(0, (it.shots || 0) + Number(d.n)); save(); render(); },
  rmdrill(d) { const it = findItem(ui.weekKey, ui.sheet.id); it.drills = (it.drills || []).filter((x) => x !== d.id); save(); render(); },
  autobuild() {
    const it = findItem(ui.weekKey, ui.sheet.id); it.drills = buildSession(it.mins || 20); save(); render();
    toast('Session built. Swap any drill you like.');
  },
  pickstart() { ui.pick = { weekKey: ui.weekKey, id: ui.sheet.id }; ui.sheet = null; ui.tab = 'drills'; render(); window.scrollTo(0, 0); },
  pickdrill(d) {
    const it = findItem(ui.pick.weekKey, ui.pick.id); if (!it) return;
    it.drills = it.drills || [];
    it.drills = it.drills.includes(d.id) ? it.drills.filter((x) => x !== d.id) : [...it.drills, d.id];
    save(); render();
  },
  pickdone() { const id = ui.pick.id; ui.weekKey = ui.pick.weekKey; ui.pick = null; ui.tab = 'week'; ui.sheet = { kind: 'item', id }; render(); },
  cat(d) { ui.cat = d.cat; ui.sub = 'All'; render(); },
  sub(d) { ui.sub = d.sub; render(); },
  drill(d) { ui.sheet = { kind: 'drill', id: d.id }; renderSheet(); $('.panelsheet').scrollTop = 0; },
  level(d) { const r = (state.drill[ui.sheet.id] = state.drill[ui.sheet.id] || {}); r.level = Number(d.v); save(); renderKeepScroll(); },
  corner() { const c = ['Top left', 'Top right', 'Bottom left', 'Bottom right']; ui.sheet.corner = c[Math.floor(Math.random() * 4)]; renderKeepScroll(); },
  score() {
    const v = parseFloat($('#scoreInput').value);
    if (!isFinite(v) || v < 0) { toast('Enter a number first.'); return; }
    const d = DRILL_BY_ID[ui.sheet.id], r = (state.drill[d.id] = state.drill[d.id] || {});
    const better = r.best == null || (d.measure.lower ? v < r.best : v > r.best);
    if (better) { r.best = v; save(); toast('New personal best!'); } else toast(`Logged. Your best is still ${r.best} ${d.measure.unit}.`);
    renderKeepScroll();
  },
  quiz(d) {
    const dr = DRILL_BY_ID[ui.sheet.id], i = Number(d.i);
    ui.sheet.quizPick = i;
    if (i === dr.quiz.answer) { (state.drill[dr.id] = state.drill[dr.id] || {}).quiz = true; save(); }
    renderKeepScroll();
  },
  quizretry() { ui.sheet.quizPick = null; renderKeepScroll(); },
  placestart(d) { ui.sheet = { kind: 'place', id: d.id }; renderSheet(); },
  place(d) {
    const day = Number(d.day), slot = d.slot, id = ui.sheet.id, w = getWeek(ui.weekKey);
    let it = w.items.find((x) => x.type === 'hockey' && x.day === day && x.slot === slot);
    if (!it) { it = { id: uid(), type: 'hockey', title: 'Hockey training', mins: 20, day, slot, done: false, drills: [], shots: 0 }; w.items.push(it); }
    if (!it.drills.includes(id)) it.drills.push(id);
    save(); ui.sheet = null; render(); toast(`Added to ${DAYS_LONG[day]} ${SLOTS[slot].toLowerCase()}.`);
  },
  saveurl() {
    const url = $('#backupUrl').value.trim();
    if (url && !/^https:\/\/script\.google\.com\//.test(url)) { toast('That does not look like a Google Apps Script link.'); return; }
    state.settings.backupUrl = url; persist();
    if (!url) { render(); toast('Backup link removed.'); return; }
    checkRemote();
  },
  backupnow() { backupNow(true); },
  askrestore() { ui.sheet = { kind: 'confirm', title: 'Restore from the Google Sheet?', text: 'This replaces everything on this iPad with the last copy saved to the Sheet.', yes: 'Restore', action: 'restore' }; renderSheet(); },
  restore() { ui.sheet = null; restoreRemote(); },
  export() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `hockey-planner-backup-${iso(new Date())}.json`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  },
  importok() { const s = ui.sheet.payload; ui.sheet = null; adopt(s); toast('Backup file loaded.'); },
};

function renderKeepScroll() {
  const p = $('.panelsheet'), y = p ? p.scrollTop : 0;
  renderSheet();
  const q = $('.panelsheet'); if (q) q.scrollTop = y;
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-a]');
  if (!el || el.disabled) return;
  const fn = A[el.dataset.a];
  if (fn) fn(el.dataset, el);
});
document.addEventListener('input', (e) => {
  const f = e.target.dataset.f;
  if (f === 'review') { getWeek(ui.weekKey).review[e.target.dataset.k] = e.target.value; save(); }
});
document.addEventListener('change', (e) => {
  const f = e.target.dataset.f;
  if (f === 'shots') {
    const it = findItem(ui.weekKey, ui.sheet.id);
    it.shots = Math.max(0, Math.round(Number(e.target.value) || 0)); save(); render();
  } else if (f === 'import') {
    const file = e.target.files[0]; if (!file) return;
    file.text().then((txt) => {
      const s = JSON.parse(txt);
      if (!validState(s)) throw new Error('bad file');
      ui.sheet = { kind: 'confirm', title: 'Load this backup file?', text: 'This replaces everything on this iPad with the contents of the file.', yes: 'Load it', action: 'importok', payload: s };
      renderSheet();
    }).catch(() => toast('That file is not a planner backup.'));
  }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ui.sheet) A.close(); });

/* ───────── Backup to Google Sheet ───────── */
function adopt(s) {
  const url = state.settings.backupUrl;
  state = s; state.drill = state.drill || {}; state.settings = state.settings || {};
  if (!state.settings.backupUrl) state.settings.backupUrl = url || '';
  persist(); render();
}
function hasUserData() {
  return Object.values(state.weeks).some((w) => w.items.some((i) => !i.fixed || i.done)) || Object.keys(state.drill).length > 0;
}
function backupRows() {
  const schedule = [], summary = [];
  for (const k of Object.keys(state.weeks).sort()) {
    const w = state.weeks[k], s = weekStats(w);
    const sorted = [...w.items].sort((a, b) => a.day - b.day || 'ampmeve'.indexOf(a.slot) - 'ampmeve'.indexOf(b.slot));
    for (const it of sorted) {
      schedule.push([k, DAYS_LONG[it.day], addDays(k, it.day), SLOTS[it.slot], SUBJECTS[it.type].label, it.title, it.mins || '', it.done ? 'Yes' : 'No',
        (it.drills || []).map((d) => (DRILL_BY_ID[d] || {}).title).filter(Boolean).join(', '), it.shots || '']);
    }
    summary.push([k, ...METERS.map((t) => `${s[t].done}/${s[t].target}`), s.hockey.done, s.hockey.mins, s.hockey.shots, s.full ? 'Yes' : 'No', w.review.good || '', w.review.change || '']);
  }
  return { schedule, summary };
}
let backupTimer, backupDirty = false;
function queueBackup() {
  if (!state.settings.backupUrl) return;
  backupDirty = true; clearTimeout(backupTimer); backupTimer = setTimeout(() => backupNow(false), 4000);
}
async function backupNow(manual, keepalive) {
  const url = state.settings.backupUrl;
  if (!url) return;
  clearTimeout(backupTimer);
  try {
    const body = JSON.stringify({ savedAt: new Date().toISOString(), state, ...backupRows() });
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body, keepalive: !!keepalive && body.length < 60000 });
    const j = await res.json();
    if (!j.ok) throw new Error(j.error || 'The Sheet refused the backup');
    backupDirty = false; meta.lastBackup = Date.now(); meta.backupError = ''; saveMeta();
    if (manual) toast('Backed up to the Google Sheet.');
  } catch (err) {
    meta.backupError = navigator.onLine === false ? 'offline, will retry' : String(err.message || err); saveMeta();
    if (manual) toast('Backup failed. Check the link and your internet.');
  }
  if (ui.tab === 'settings' && !ui.sheet && document.activeElement?.id !== 'backupUrl') render();
}
async function fetchRemote() {
  const url = state.settings.backupUrl;
  const res = await fetch(url + (url.includes('?') ? '&' : '?') + 'action=restore');
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || 'The Sheet refused the request');
  return j;
}
async function checkRemote() {
  try {
    const j = await fetchRemote();
    if (validState(j.state) && !hasUserData()) {
      ui.sheet = { kind: 'confirm', title: 'Backup found', text: `The Sheet has a backup saved ${j.savedAt ? new Date(j.savedAt).toLocaleString() : 'earlier'}, and this iPad has no plan yet. Restore it?`, yes: 'Restore', action: 'restore' };
      render(); return;
    }
    toast('Link works. Backing up now.'); await backupNow(false); render();
  } catch (err) { meta.backupError = String(err.message || err); saveMeta(); render(); toast('Could not reach the Sheet. Check the link.'); }
}
async function restoreRemote() {
  try {
    const j = await fetchRemote();
    if (!validState(j.state)) throw new Error('No backup in the Sheet yet');
    adopt(j.state); toast('Restored from the Google Sheet.');
  } catch (err) { render(); toast(String(err.message || 'Restore failed.')); }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && backupDirty) backupNow(false, true);
  if (document.visibilityState === 'visible' && ui.tab === 'week' && !ui.sheet) render();
});
window.addEventListener('online', () => { if (backupDirty) backupNow(false); });

/* ───────── Start ───────── */
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
render();
