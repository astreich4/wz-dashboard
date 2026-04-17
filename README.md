# Warzone Dashboard Repo

This repo is a static Google Sheets-powered dashboard using the sheet's **public CSV export URL** for a single games tab.

## Files
- `index.html` — dashboard UI
- `app.js` — public-sheet fetch + transform + dashboard logic
- `config.js` — your sheet config
- `.nojekyll` — optional for GitHub Pages

## Setup
1. Open `config.js`
2. Replace `YOUR_GOOGLE_SHEET_ID`
3. Set the `gid` for your games tab
4. Make your Google Sheet public as **Anyone with the link → Viewer**
5. Push these files to GitHub
6. Enable **GitHub Pages** for the repo

## How to find the tab gid
Open the sheet and click the games tab.
The URL will end with something like `#gid=123456789`.
That number is the tab's `gid`.

## Expected columns
The dashboard is built for the same format as your uploaded CSV:
- `Date`
- `Game Id`
- `Player`
- `Eliminations`
- `Kills`
- `Assists`
- `Redeploys`
- `Damage`
- `Win`
- `GameType`

`Score` can exist in the sheet but is ignored because the dashboard uses the scoring formula shown on the page.

## Notes
- No API key is needed
- The sheet must be public/viewable
- The dashboard is read-only
- All nightly and all-time totals are calculated from the games tab
