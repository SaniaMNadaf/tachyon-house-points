# Tachyon House Points

A house-points website for four college houses: **Alpha, Infer, Matrix and Layer**. Admins add or deduct points, and everyone can see the totals, the ranking and the winning house.

It is a single static page (HTML, CSS and JavaScript) with a Three.js background. There is no server and no build step.

## What the assignment asks for, and where it lives

| Requirement | Where |
|---|---|
| Enter a house and points | Admin page → "Add / deduct points" form |
| Add the points to the house | `saveEntries()` stores each change; `standings()` adds them up |
| Show the total for all four houses | Home page, leaderboard banners, each house page |
| Rank the houses highest to lowest | `standings()` computes `rank`; leaderboard has a **By rank** toggle |
| Show the winning house | "Leading: MATRIX · 310 pts" bar on the leaderboard (shows a tie when needed) |

## Pages

Pages are routed with the URL hash, so everything works from one `index.html`.

| Hash | Page |
|---|---|
| `#home` | Landing page with the four interactive shields |
| `#leaderboard` | Winner bar plus four rank banners (fixed order or sorted by rank) |
| `#house-alpha`, `#house-infer`, `#house-matrix`, `#house-layer` | One template, themed per house: rank, total, weekly change, rivalry, points log, chart |
| `#notifications` | Feed of every points change |
| `#admin` | Admin dashboard (password protected) |
| `#rules`, `#privacy` | Text pages |

## How it works (the "backend")

There is no backend server. All logic runs in the browser.

**Data model.** Points are stored as a list of entries, not as four running totals:

```js
{ id, house: 'alpha' | 'infer' | 'matrix' | 'layer', points: 15, reason: 'Speed Test', ts: 1760000000000 }
```

A deduction is just an entry with negative points. Because everything is an entry, the history, the totals, the weekly change and the chart can never disagree with each other.

**Standings (`standings()`).** On every render the app loops over the entries and builds, per house:

- `pts` – sum of all its entries
- `week` – sum of entries from the last 7 days ("Change this week")
- `rank` – `1 + number of houses with strictly more points`, so equal totals share a rank
- `tied` – true when another house has the same total (shown as "3rd Place (Tied)")
- `gap` – points behind the leader (shown as "−20 behind 1st")
- `leader` – true for the highest total (several houses can lead in a tie)

**Storage.** Entries are saved in the browser's `localStorage` under `tachyon.entries.v1`. If storage is blocked, an in-memory copy is used instead. First visit loads sample data (Alpha 290, Infer 220, Matrix 310, Layer 220).

**Admin.** The admin page asks for a password (`tachyon`, checked in the browser) and unlocks a dashboard to add or deduct points, see history, remove an entry, restore the sample data or clear everything. After each change the app re-renders, so every page updates immediately.

**Rendering.** `render()` reads `location.hash`, builds the HTML for that page as a string, puts it in `<main id="app">`, applies the house theme colour (`--c`, `--rgb` CSS variables), then runs the entrance animations and count-up numbers.

**Visuals.** A Three.js layer (r128, loaded from a CDN) draws ember particles behind the page and on the home-page shields. The CSS adds the glows, banner shapes (`clip-path`) and entrance animations. Motion is turned off for visitors who prefer reduced motion. Nothing follows the cursor.

## Important limits

- **Points live in each visitor's own browser.** Two people opening the site see their own data, so a change made by an admin is not visible to anyone else. For a real shared leaderboard, the entries need to live in a database behind an API.
- **The admin password is not secure.** It is checked in the browser and is visible in the source. It is fine for a demo only.
- House leader accounts and approvals were left out because they need a real backend.

## Run it

Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

An internet connection is needed for the Three.js and Google Fonts CDN links.

## Project structure

```
index.html          the whole app (styles, markup, logic)
img/
  home-bg.jpg       landing background
  cut-<house>.png   transparent shield cutouts (home, leaderboard)
  art-<house>.jpg   creature art on the house pages
  hero.jpg          wide hero image
```

## Customising

- **Houses** (names, colours, mottos, members, trophies): the `HOUSES` array in `index.html`.
- **Sample data**: `seed()`.
- **Admin password**: search for `'tachyon'` in the admin sign-in code.
- **Colours and fonts**: the CSS variables at the top of the `<style>` block.

## Next steps

1. Replace `localStorage` with an API and database (for example Node + SQLite, or Firebase) so all visitors share the same points.
2. Add real admin login with sessions.
3. Add house-leader accounts and an approval flow for point requests.
