// TechXchange 2026: turn your catalogue favourites into an agenda page and an .ics file.
// Run in the browser console on the session catalog page while signed in.
// Copyright (c) 2026 Nathan Carroll. MIT licence, see LICENSE.
(() => {

  const API = 'https://events.tools.ibm.com/api/';
  const SESSION_URL = 'https://reg.tools.ibm.com/flow/ibm/techxchange26/sessioncatalog/page/sessioncatalog/session/';
  // Public IDs the catalogue page itself sends on every request, not secrets
  const HDRS = {
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    rfWidgetId: 'ChglfSDiz1jlTR8V97Qf6kYzs773nQuF', rfApiProfileId: 'HkAL70o02Smvj2jmwmYgs7v3n6fMYzK1'
  };
  // A favourite's session ID, whichever form myData sends it in
  const idOf = x => typeof x === 'string' ? x : x.sessionID || x.sessionId || x.id;

  /**
   * Builds the agenda page and calendar file from your favourites, and downloads both.
   */
  async function main() {

    // Only run on the catalogue page
    if (location.hostname !== 'reg.tools.ibm.com') throw new Error('Run this on the TechXchange 2026 session catalog page');

    // Read your favourites and the whole catalogue
    const token = signInToken();
    const fav = await readFavourites(token);
    const catalogue = await readCatalogue(token);

    // Match them up, then pick a time for each
    const { favs, missing } = await matchFavourites(fav, catalogue, token);
    const plan = { favs, missing, ...planSlots(favs) };

    // Build both files and download them
    const html = agendaPage(plan);
    const ics = calendarFile(plan.chosen);
    download('techxchange26-agenda.html', 'text/html', html);
    download('techxchange26.ics', 'text/calendar', ics);

    // Sum up in the console
    report(plan);
  }

  /**
   * POSTs to the event API, signed in.
   *
   * @param path  API path under /api/
   * @param body  Form-encoded request body
   * @param token Sign-in token
   * @return the reply as JSON
   */
  async function post(path, body, token) {
    const r = await fetch(API + path, {
      method: 'POST', credentials: 'include', body,
      headers: { ...HDRS, rfAuthToken: token }
    });
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
    return r.json();
  }

  /**
   * Finds the sign-in token the catalogue page holds.
   *
   * @return the token
   */
  function signInToken() {
    const cookie = document.cookie.match(/(?:^|;\s*)rfjwt=([^;]+)/);
    const token = window.authToken || (cookie && decodeURIComponent(cookie[1]));
    if (!token) throw new Error('Not signed in - sign in on the catalog page, reload it, then run this again');
    return token;
  }

  /**
   * Reads your favourites from myData, which sends them as a list or as a map keyed by session ID.
   *
   * @param token Sign-in token
   * @return the favourite session IDs, and the myData entries behind them
   */
  async function readFavourites(token) {

    // Collect the IDs
    const my = await post('myData', '', token);
    const si = my.sessionInterests;
    const ids = new Set(Array.isArray(si) ? si.map(idOf) : Object.keys(si || {}));
    const entries = Array.isArray(si) ? si : Object.values(si || {});

    // None found? Log the reply's shape and stop
    if (!ids.size) {
      console.log('myData fields:', Object.keys(my), 'code:', my.responseCode, my.responseMessage,
        'sessionInterests:', Array.isArray(si) ? `array of ${si.length}` : typeof si);
      throw new Error('No favourites found in myData (shape logged above)');
    }
    return { ids, entries };
  }

  /**
   * Reads the whole catalogue as you see it signed in.
   *
   * @param token Sign-in token
   * @return every session in the catalogue
   */
  async function readCatalogue(token) {
    const page = from => post('sessions', 'type=session&catalogDisplay=list&from=' + from, token);
    // The first page wraps its results in sectionList, later pages do not
    const items = p => (p.sectionList ? p.sectionList[0] : p);

    // First page, which gives the total
    const first = items(await page(0));
    const all = [...first.items];

    // The rest, five pages at a time, 50 to a page
    const froms = [];
    for (let f = 50; f < first.total; f += 50) froms.push(f);
    for (let i = 0; i < froms.length; i += 5)
      (await Promise.all(froms.slice(i, i + 5).map(page))).forEach(p => all.push(...(items(p).items || [])));
    return all;
  }

  /**
   * Finds your favourites in the catalogue, and looks up any it does not list.
   *
   * @param fav       Favourite IDs and their myData entries
   * @param catalogue Every session in the catalogue
   * @param token     Sign-in token
   * @return the favourite sessions, and the favourites that have gone
   */
  async function matchFavourites(fav, catalogue, token) {

    // Favourites the catalogue lists
    const favs = catalogue.filter(s => fav.ids.has(s.sessionID));
    const missing = [];

    // Look up each one it does not
    for (const id of [...fav.ids].filter(id => !favs.some(s => s.sessionID === id))) {
      const r = await post('session', 'id=' + encodeURIComponent(id), token).catch(e => ({ responseMessage: e.message }));
      const e = fav.entries.find(x => x && idOf(x) === id) || {};

      // Still live? Keep it as unlisted, otherwise name it as missing
      if (r.items?.[0]) favs.push({ ...r.items[0], unlisted: true });
      else missing.push({ id, code: e.code || e.abbreviation || '?', title: e.title || '?', reason: r.responseMessage || 'not found' });
    }
    return { favs, missing };
  }

  /**
   * Gives each favourite one time slot and marks the clashes.
   *
   * @param favs Favourite sessions
   * @return the chosen slots in time order, the favourites with no time yet, and how many slots clash
   */
  function planSlots(favs) {
    // API times read 2026/10/27 14:30:00, in UTC
    const utc = s => new Date(s.replace(/\//g, '-').replace(' ', 'T') + 'Z');
    const slot = (s, t) => ({ s, t, start: utc(t.utcStartTime), end: utc(t.utcEndTime) });
    const overlaps = (a, b) => a.start < b.end && b.start < a.end;
    const timed = favs.filter(s => (s.times || []).length);
    const untimed = favs.filter(s => !(s.times || []).length);

    // Single-time favourites are fixed
    const chosen = timed.filter(s => s.times.length === 1).map(s => slot(s, s.times[0]));

    // Repeats take their least-clashing time, fewest options first
    timed.filter(s => s.times.length > 1).sort((a, b) => a.times.length - b.times.length).forEach(s => {
      const opts = s.times.map(t => slot(s, t)).sort((a, b) => a.start - b.start);
      const cost = o => chosen.filter(c => overlaps(c, o)).length;

      // Least clashes wins, ties going to the earliest
      const best = opts.reduce((b, o) => cost(o) < cost(b) ? o : b);
      best.others = opts.filter(o => o !== best);
      chosen.push(best);
    });

    // Order the slots and mark each one's clashes
    chosen.sort((a, b) => a.start - b.start || a.end - b.end);
    chosen.forEach(c => c.clash = chosen.filter(o => o !== c && overlaps(c, o)));
    return { chosen, untimed, clashing: chosen.filter(c => c.clash.length).length };
  }

  /**
   * Lists a slot's notes: its clashes, its other times, and whether the catalogue lists it.
   *
   * @param c A chosen slot
   * @return the notes, empty when there are none
   */
  function notes(c) {
    const when = o => `${o.t.dayName.slice(0, 3)} ${o.t.startTimeFormatted}`;
    return [
      c.clash.length && 'Clashes with ' + c.clash.map(o => o.s.code).join(', '),
      c.others?.length && 'Also runs ' + c.others.map(when).join(', '),
      c.s.unlisted && 'Not listed in the catalogue'
    ].filter(Boolean);
  }

  /**
   * Builds the agenda page: one table per day, then the untimed and missing favourites.
   *
   * @param plan Favourites, chosen slots, untimed and missing favourites, clash count
   * @return the page as HTML
   */
  function agendaPage({ favs, chosen, untimed, missing, clashing }) {
    const esc = x => String(x ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    const link = s => `<a href="${SESSION_URL}${encodeURIComponent(s.sessionID)}" style="white-space:nowrap">${esc(s.code)}</a>`;
    const table = (head, rows) => `<table><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr>${rows.join('')}</table>`;

    // Event's UTC offset in hours, from the first slot's local time
    const offset = chosen.length ? Math.round((new Date(chosen[0].t.date + 'T' + chosen[0].t.startTime + 'Z') - chosen[0].start) / 36e5) : 0;

    // One table per day, clashes highlighted
    const days = {};
    chosen.forEach(c => (days[c.t.dateFormatted] ||= []).push(c));
    const row = c => `<tr${c.clash.length ? ' class="clash"' : ''}><td class="t">${esc(c.t.startTimeFormatted)} - ${esc(c.t.endTimeFormatted)}</td>`
      + `<td>${link(c.s)}</td><td>${esc(c.s.title)}</td><td>${esc(c.s.type)}</td><td>${esc(c.t.room)}</td><td>${notes(c).map(esc).join('<br>')}</td></tr>`;
    const dayTables = Object.entries(days).map(([d, cs]) => `<h2>${esc(d)}</h2>` + table(['Time', 'Code', 'Title', 'Type', 'Room', 'Notes'], cs.map(row)));

    // Then the untimed and missing favourites
    const untimedTable = !untimed.length ? '' : '<h2>No time yet</h2>' + table(['Code', 'Title', 'Type'],
      untimed.map(s => `<tr><td>${link(s)}</td><td>${esc(s.title)}</td><td>${esc(s.type)}</td></tr>`));
    const missingTable = !missing.length ? '' : '<h2>Favourites that no longer exist</h2>' + table(['Code', 'Title', 'Reason'],
      missing.map(m => `<tr><td>${esc(m.code !== '?' ? m.code : m.id)}</td><td>${esc(m.title)}</td><td>${esc(m.reason)}</td></tr>`));

    // The page
    return `<!doctype html><meta charset="utf-8"><title>TechXchange 2026 agenda</title>
<style>body{font:14px/1.4 system-ui,sans-serif;margin:24px;color:#161616}h2{margin:28px 0 8px}
table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #ddd;padding:6px 8px;text-align:left;vertical-align:top}
th{background:#f2f2f2}td.t{white-space:nowrap}tr.clash td{background:#fff3cd}p.meta{color:#555}a{color:#0f62fe}</style>
<h1>TechXchange 2026 agenda</h1>
<p class="meta">${favs.length} favourites, ${chosen.length} with a time, ${clashing} in clashes (highlighted), ${untimed.length} with no time yet.
Times are event local (UTC${offset < 0 ? '' : '+'}${offset}). Built ${esc(new Date().toLocaleString())}.</p>
${dayTables.join('\n')}
${untimedTable}
${missingTable}`;
  }

  /**
   * Builds the calendar file: one event per slot, in UTC.
   *
   * @param chosen Chosen slots
   * @return the file as iCalendar text
   */
  function calendarFile(chosen) {
    const text = h => new DOMParser().parseFromString(h || '', 'text/html').body.textContent.trim();
    const icsEsc = x => String(x ?? '').replace(/\\/g, '\\\\').replace(/\r\n?|\n/g, '\\n').replace(/[,;]/g, m => '\\' + m);
    const stamp = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const now = stamp(new Date());

    // One event per slot
    const ev = c => ['BEGIN:VEVENT', `UID:${encodeURIComponent(c.t.sessionTimeID)}@techxchange26`, `DTSTAMP:${now}`,
      `DTSTART:${stamp(c.start)}`, `DTEND:${stamp(c.end)}`, `SUMMARY:${icsEsc(c.s.code + ' ' + c.s.title)}`,
      `LOCATION:${icsEsc(c.t.room)}`, `URL:${SESSION_URL}${encodeURIComponent(c.s.sessionID)}`,
      `DESCRIPTION:${icsEsc([c.s.type, ...notes(c), text(c.s.abstract)].filter(Boolean).join('\n\n'))}`, 'END:VEVENT'];

    // Wrap them in the calendar, folding every line
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//techxchange26-agenda//EN', 'CALSCALE:GREGORIAN',
      'X-WR-CALNAME:TechXchange 2026', ...chosen.flatMap(ev), 'END:VCALENDAR'].map(fold).join('\r\n') + '\r\n';
  }

  /**
   * Folds an iCalendar line at 75 bytes, the format's line limit.
   *
   * @param line One unfolded line
   * @return the line, with each continuation on a new line starting with a space
   */
  function fold(line) {
    const out = [], enc = new TextEncoder();
    let cur = '';
    for (const ch of line) {
      if (enc.encode(cur + ch).length > 75) { out.push(cur); cur = ' ' + ch; } else cur += ch;
    }
    return [...out, cur].join('\r\n');
  }

  /**
   * Downloads text as a file.
   *
   * @param name File name
   * @param type MIME type
   * @param body File contents
   */
  function download(name, type, body) {
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([body], { type })), download: name });
    document.body.appendChild(a); a.click(); a.remove();
  }

  /**
   * Prints the agenda and a summary in the console.
   *
   * @param plan Favourites, chosen slots, untimed and missing favourites, clash count
   */
  function report({ favs, chosen, untimed, missing, clashing }) {

    // The agenda
    console.table(chosen.map(c => ({ day: c.t.dayName, time: c.t.startTimeFormatted, code: c.s.code, title: c.s.title, notes: notes(c).join('; ') })));

    // Unlisted and missing favourites
    const unlisted = favs.filter(s => s.unlisted).map(s => s.code);
    if (unlisted.length) console.log('Favourites not listed in the catalogue but still live (added to the agenda):', unlisted.join(', '));
    if (missing.length) { console.log('Favourites that no longer exist:'); console.table(missing); }

    // Summary
    console.log(`${favs.length} favourites: ${chosen.length} timed, ${clashing} in clashes, ${untimed.length} with no time yet. Downloaded techxchange26-agenda.html and techxchange26.ics`);
  }

  main().catch(e => console.error('techxchange26-agenda:', e.message));
})();
