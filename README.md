# 🏀 Arch Madness 2026 Pick'em

State Farm Missouri Valley Conference Tournament pick'em app — built on Cloudflare Pages + Functions + KV.

**Features:**
- Register & login (persistent sessions)
- Full interactive bracket picker (Games 1–10)
- Championship combined score prediction (tiebreaker)
- Picks lock automatically at **Thu Mar 5, 3:30p CT** (first tip-off)
- Leaderboard with live scoring as you enter results
- View any player's picks after the bracket locks
- Admin panel for entering game results round-by-round
- Mobile responsive

**Scoring:**
| Round | Games | Points Each |
|-------|-------|-------------|
| Round 1 (Thu) | G1, G2, G3 | 1 pt |
| Round 2 (Fri) | G4, G5, G6, G7 | 2 pts |
| Semifinals (Sat) | G8, G9 | 4 pts |
| Championship (Sun) | G10 | 8 pts |
| **Max total** | | **27 pts** |

**Tiebreaker:** Closest combined championship score prediction wins.

---

## Setup

### 1. Clone & install
```bash
git clone <your-repo>
cd arch-madness-picks
npm install
```

### 2. Create a KV namespace
```bash
npx wrangler kv namespace create PICKS_KV
# Also create a preview namespace for local dev:
npx wrangler kv namespace create PICKS_KV --preview
```

Copy the `id` values into `wrangler.toml`.

### 3. Set the admin password secret
```bash
# For local dev:
echo "yourpassword" | npx wrangler pages secret put ADMIN_PASSWORD

# For production (after connecting to GitHub):
# Set via Cloudflare Dashboard → Pages → arch-madness-picks → Settings → Environment Variables
```

### 4. Deploy to Cloudflare Pages (via GitHub)

1. Push this repo to GitHub
2. Go to [Cloudflare Dashboard](https://dash.cloudflare.com) → **Pages** → **Create a project** → **Connect to Git**
3. Select your repo
4. Build settings:
   - **Build command:** *(leave blank — no build step needed)*
   - **Build output directory:** `public`
5. Click **Save and Deploy**

After first deploy, go to **Settings → Functions → KV namespace bindings** and bind `PICKS_KV` to the namespace you created.

### 5. Local development
```bash
npm run dev
# Opens at http://localhost:8788
```

---

## Admin panel

Navigate to `/?admin` (e.g. `https://your-site.pages.dev/?admin`) to reveal the Admin tab.

Enter game results after each round and save with your admin password. Scores on the leaderboard update immediately.

---

## File structure

```
arch-madness-picks/
├── public/
│   └── index.html          ← Frontend SPA (all HTML/CSS/JS)
├── functions/
│   └── api/
│       └── [[route]].js    ← Cloudflare Pages Function (all API routes)
├── wrangler.toml
├── package.json
└── README.md
```

## API routes

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/register` | Register new user |
| POST | `/api/login` | Login |
| GET | `/api/picks/me` | Get your current picks |
| POST | `/api/picks` | Submit/update picks |
| GET | `/api/leaderboard` | Get leaderboard + results |
| GET | `/api/results` | Get current results + lock status |
| POST | `/api/results` | Save results (admin only) |
