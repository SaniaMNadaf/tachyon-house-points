# Tachyon House Points

A house-points website for four college houses: **Alpha, Infer, Matrix and Layer**. Admins add or deduct points, and everyone sees the same totals, the ranking and the winning house.

- **Frontend:** one static page (`public/index.html`) with a Three.js background.
- **Backend:** Node.js + Express + SQLite, with real admin accounts.

## What the assignment asks for, and where it lives

| Requirement | Where |
|---|---|
| Enter a house and points | Admin → **Add Points** form |
| Add the points to the house | `POST /api/entries` saves an entry in the database |
| Show the total for all four houses | Home, leaderboard banners and each house page (computed from the entries) |
| Rank the houses highest to lowest | `standings()` in `public/index.html`; the leaderboard has a **By rank** toggle |
| Show the winning house | "Leading: MATRIX · 310 pts" bar on the leaderboard (shows a tie when needed) |

## Run it

Needs Node.js 22.13 or newer (check with `node -v`). The database is the SQLite built into Node, so there is nothing to compile and no extra tools to install.

```bash
npm install
cp .env.example .env      # optional: set ADMIN_USERNAME / ADMIN_PASSWORD
npm start
# open http://localhost:3000
```

On the first run the server creates the **super admin** and loads sample points:

- If you set `ADMIN_PASSWORD` in `.env`, that is the password.
- If you did not, a random password is printed in the terminal once, and you must change it at first login.

Run the tests (14 checks on login, permissions, validation and rate limiting):

```bash
npm test
```

## Who sees what

| | Visitors | Admin | Super admin |
|---|:-:|:-:|:-:|
| Home, Leaderboard, House pages, Notifications | ✔ | ✔ | ✔ |
| Add or deduct points | | ✔ | ✔ |
| Points history, remove an entry | | ✔ | ✔ |
| Change own password | | ✔ | ✔ |
| Create, disable and reset admin accounts | | | ✔ |

There is no public sign-up. Visitors only see a **Sign in** button; after signing in, an admin gets an extra **Add Points** link in the navigation bar and the button becomes **Sign out**.

## How admin access works

1. **You (the super admin)** click **Sign in** in the top bar (it also sits in the footer).
2. Open **Manage Admins**, enter a username and a temporary password for a teacher (there is a *Generate one* button) and press **Create admin**. Give them the username and temporary password.
3. The new admin signs in. Because the password is temporary, the site makes them **choose their own password** before they can do anything.
4. They use **Add Points**. Every entry records **who added it** and when (see Points History).
5. If someone leaves, press **Disable**: they are signed out immediately and cannot sign in again. Their past entries keep their name.
6. If someone forgets their password, use **Reset a password**: it signs them out and forces a new password at next login.

Safety rules the server enforces: you cannot disable yourself, and there must always be at least one active super admin.

## How it works

**Entries, not totals.** Points are stored as a list of entries:

```
id, house (alpha|infer|matrix|layer), points (negative for a deduction), reason, created_at, admin_name
```

Totals, weekly change, rank, ties and the chart are all calculated from this one list, so they can never disagree.

**Standings** (`standings()` in the page):

- `pts` – sum of the house's entries
- `week` – sum of entries from the last 7 days ("Change this week")
- `rank` – `1 + number of houses with strictly more points` (equal totals share a rank)
- `tied` – another house has the same total (shown as "3rd Place (Tied)")
- `gap` – points behind the leader
- `leader` – highest total (several houses lead in a tie)

**Request flow when an admin adds points**

1. The browser sends `POST /api/entries` with the login cookie.
2. The server checks the cookie belongs to an active admin who has chosen their own password.
3. The server validates the input: a real house, a whole number from -1000 to 1000 (not 0), a reason of 1 to 80 characters.
4. It saves the entry with the admin's name and the time.
5. Every visitor's page asks the server for the entries every 15 seconds (and when the tab is shown again), so numbers update by themselves and count up to the new value.

## API

| Method and path | Who | Does |
|---|---|---|
| `GET /api/entries` | anyone | All entries, newest first |
| `GET /api/me` | anyone | The signed-in admin, or `null` |
| `POST /api/login` | anyone | `{username, password}` → sets the session cookie |
| `POST /api/logout` | anyone | Ends the session |
| `POST /api/me/password` | admin | `{current, next}` |
| `POST /api/entries` | admin | `{house, points, reason}` |
| `DELETE /api/entries/:id` | admin | Remove an entry |
| `GET /api/admins` | super | List accounts |
| `POST /api/admins` | super | `{username, password, role}` creates an account with a temporary password |
| `PATCH /api/admins/:id` | super | `{active}` enable/disable, or `{password}` reset |

## Security

- Passwords are **hashed with bcrypt**; the database never holds a plain password.
- Login gives a random session token in an **httpOnly, SameSite=Lax cookie** (also `Secure` in production). Only a hash of the token is stored in the database. Sessions last 12 hours.
- **Every write is checked on the server.** Hiding a page in the browser is not what protects the data.
- A wrong username and a wrong password give the same message and take the same time.
- Login is **rate limited** (10 failed attempts per 15 minutes per IP).
- Cross-site writes are rejected (`Origin` check plus SameSite cookies).
- Inputs are validated on the server, and page text is escaped before it is shown.

## Project structure

```
server/
  index.js        starts the server (reads .env, first-run setup)
  app.js          routes, sessions, validation
  db.js           SQLite tables, first admin, sample data
public/
  index.html      the whole website (styles, markup, logic)
  img/            shields, creature art, backgrounds
test/api.test.js  API tests
data/             the SQLite file (created on first run, not in git)
.env.example      settings you can copy to .env
```

## Hosting notes

- Put it on a host that runs Node (Render, Railway, a VPS). Set `NODE_ENV=production`, `ADMIN_USERNAME` and `ADMIN_PASSWORD`, and serve it over HTTPS.
- SQLite stores everything in one file (`data/tachyon.db`, or `DB_PATH`). **Use a host with a persistent disk**, because free hosts that reset their disk will erase your points. If that is not possible, move the database to Postgres (the SQL in `server/` is small).
- Back up the `.db` file before the event.

## Customising

- **Houses** (names, colours, mottos, members, trophies): the `HOUSES` array in `public/index.html`. The four house ids must match the `CHECK` in `server/db.js`.
- **Start empty:** `SEED_SAMPLE=false` in `.env` before the first run.
- **Session length, point limits, rate limit:** constants at the top of `server/app.js`.

## Not built yet

- House-leader accounts and approval of point requests.
- "Forgot password" by email (an admin resets it by hand instead).
- Live push updates (the page polls every 15 seconds instead).
