# Warzone Dashboard Repo (No API Key Required)

This repo is a static Google Sheets-powered dashboard styled after your uploaded `test.html`, but it uses the sheet's **public CSV export URLs** instead of the Google Sheets API.

## Files
- `index.html` — dashboard UI
- `app.js` — public-sheet fetch + transform + dashboard logic
- `config.js` — your sheet config
- `.nojekyll` — recommended for GitHub Pages

## Setup
1. Open `config.js`
2. Replace `YOUR_GOOGLE_SHEET_ID`
3. Set the `gid` for each tab you want to load
4. Make your Google Sheet public as **Anyone with the link → Viewer**
5. Push these files to GitHub
6. Enable **GitHub Pages** for the repo

## How to find each tab gid
Open the sheet and click the tab.
The URL will end with something like `#gid=123456789`.
That number is the tab's `gid`.

## Expected games-tab columns
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
- The nightly totals tab is optional in this version; the app will try to load it if you provide a valid `gid`
