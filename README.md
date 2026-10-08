# TechXchange 2026 agenda builder

The TechXchange 2026 session catalogue lets you favourite sessions, but scheduling is switched off on the site for now. There is no "Add to Schedule" button and no calendar export, so your favourites cannot get into your calendar.

This script reads your favourites and downloads two files:

- `techxchange26-agenda.html`: your sessions by day, with times and rooms. Clashes are highlighted.
- `techxchange26.ics`: one calendar entry per session, for Outlook, Google Calendar or Apple Calendar.

## Run it

1. Sign in to the [session catalog](https://reg.tools.ibm.com/flow/ibm/techxchange26/sessioncatalog/page/sessioncatalog) and favourite your sessions.
2. On that page, open the browser console: Cmd+Opt+K in Firefox, Cmd+Opt+J in Chrome (Ctrl+Shift+K or Ctrl+Shift+J on Windows).
3. Paste the script and press Enter. The first time, the browser asks you to type `allow pasting`.

The console shows each step as it runs. Both files then download, and the console prints a summary table. If the browser asks whether to allow multiple downloads, allow it.

## What it does

- Reads your favourites and the full catalogue, about 1,200 sessions.
- A session that runs more than once gets the time with the fewest clashes. The other times are listed in its notes.
- A favourite that is no longer in the catalogue is named at the bottom of the agenda.
- The agenda shows event local time (UTC-4). Calendar entries are in UTC, so your calendar shows them in your own time zone.
- Each entry keeps the same ID between runs. Re-importing after you change your favourites should update entries rather than duplicate them, depending on the calendar app.

## What it touches

- It only reads. Nothing on your account changes.
- It talks only to IBM's event API at `events.tools.ibm.com`, making the same calls the catalogue page makes. Your login token goes there and nowhere else.
- The two IDs in the script (`rfWidgetId`, `rfApiProfileId`) are public. The catalogue page sends them on every request. They are not keys.
- It is about 300 lines, laid out as a `main` function followed by one function per step. Read it before you run it.

## Limits

- It depends on how the event site works today. None of that is documented, and it can change without notice.
- It is built for TechXchange 2026 only.
- If IBM switches scheduling on, the site's own calendar export will cover the basics.
- Not affiliated with or supported by IBM.

## Licence

MIT. See `LICENSE`.
