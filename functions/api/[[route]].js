// ============================================================
// Arch Madness 2026 Pick'em — API (Cloudflare Pages Function)
// ============================================================

const LOCK_TIME = new Date('2026-03-05T21:30:00Z'); // 3:30pm CT = 9:30pm UTC
const MAX_BRACKETS_PER_USER = 2;

const GAMES = [
  { id: 'g1',  round: 1, label: 'Game 1',       teams: ['siu', 'drake'],         feedsInto: 'g4'  },
  { id: 'g2',  round: 1, label: 'Game 2',       teams: ['valpo', 'indstate'],    feedsInto: 'g6'  },
  { id: 'g3',  round: 1, label: 'Game 3',       teams: ['uni', 'evansville'],    feedsInto: 'g7'  },
  { id: 'g4',  round: 2, label: 'Game 4',       teams: ['belmont', 'W:g1'],      feedsInto: 'g8'  },
  { id: 'g5',  round: 2, label: 'Game 5',       teams: ['murraystate', 'uic'],   feedsInto: 'g8'  },
  { id: 'g6',  round: 2, label: 'Game 6',       teams: ['bradley', 'W:g2'],      feedsInto: 'g9'  },
  { id: 'g7',  round: 2, label: 'Game 7',       teams: ['illstate', 'W:g3'],     feedsInto: 'g9'  },
  { id: 'g8',  round: 3, label: 'Semifinal 1',  teams: ['W:g4', 'W:g5'],         feedsInto: 'g10' },
  { id: 'g9',  round: 3, label: 'Semifinal 2',  teams: ['W:g6', 'W:g7'],         feedsInto: 'g10' },
  { id: 'g10', round: 4, label: 'Championship', teams: ['W:g8', 'W:g9'],         feedsInto: null  },
];

const POINTS = { 1: 1, 2: 2, 3: 4, 4: 8 };

// ────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function randomToken() {
  const arr = new Uint8Array(24);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function isLocked() {
  return new Date() >= LOCK_TIME;
}

async function getUsername(env, request) {
  const auth  = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return null;
  return await env.PICKS_KV.get(`session:${token}`);
}

function calcScore(userPicks, results) {
  if (!results?.games) return 0;
  return GAMES.reduce((total, game) => {
    const pick   = userPicks?.games?.[game.id];
    const result = results.games[game.id];
    return total + (pick && result && pick === result ? POINTS[game.round] : 0);
  }, 0);
}

// ────────────────────────────────────────────────────────────
// HANDLERS
// ────────────────────────────────────────────────────────────

async function handleRegister(request, env) {
  const { username, password } = await request.json().catch(() => ({}));
  if (!username || !password) return json({ error: 'Username and password required' }, 400);
  if (username.length < 2 || username.length > 20) return json({ error: 'Username must be 2–20 characters' }, 400);
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) return json({ error: 'Username: letters, numbers, _ and - only' }, 400);

  const key = `user:${username.toLowerCase()}`;
  if (await env.PICKS_KV.get(key)) return json({ error: 'Username already taken' }, 409);

  const passwordHash = await sha256(password + username.toLowerCase());
  await env.PICKS_KV.put(key, JSON.stringify({ username, passwordHash, createdAt: new Date().toISOString() }));

  const token = randomToken();
  await env.PICKS_KV.put(`session:${token}`, username.toLowerCase(), { expirationTtl: 86400 * 14 });
  return json({ token, username });
}

async function handleLogin(request, env) {
  const { username, password } = await request.json().catch(() => ({}));
  if (!username || !password) return json({ error: 'Username and password required' }, 400);

  const userJson = await env.PICKS_KV.get(`user:${username.toLowerCase()}`);
  if (!userJson) return json({ error: 'Invalid username or password' }, 401);

  const user = JSON.parse(userJson);
  const hash = await sha256(password + username.toLowerCase());
  if (hash !== user.passwordHash) return json({ error: 'Invalid username or password' }, 401);

  const token = randomToken();
  await env.PICKS_KV.put(`session:${token}`, username.toLowerCase(), { expirationTtl: 86400 * 14 });
  return json({ token, username: user.username });
}

async function handleSubmitPicks(request, env) {
  const username = await getUsername(env, request);
  if (!username) return json({ error: 'Not authenticated' }, 401);
  if (isLocked()) return json({ error: 'Bracket is locked — tournament has started!' }, 403);

  const body = await request.json().catch(() => ({}));
  const { games, champScore } = body;

  for (const game of GAMES) {
    if (!games?.[game.id]) return json({ error: `Missing pick for ${game.label}` }, 400);
  }

  if (champScore == null || isNaN(Number(champScore)) || Number(champScore) < 0 || Number(champScore) > 500) {
    return json({ error: 'Invalid championship score prediction (0–500)' }, 400);
  }

  // Check existing brackets — once submitted a slot is LOCKED, no edits
  const b1 = await env.PICKS_KV.get(`picks:${username}:1`);
  const b2 = await env.PICKS_KV.get(`picks:${username}:2`);

  if (b1 && b2) {
    return json({ error: `You've already submitted both brackets. Max ${MAX_BRACKETS_PER_USER} per person — no changes allowed.` }, 403);
  }

  const slot = b1 ? 2 : 1;

  await env.PICKS_KV.put(`picks:${username}:${slot}`, JSON.stringify({
    username,
    slot,
    games,
    champScore: Math.round(Number(champScore)),
    submittedAt: new Date().toISOString(),
  }));

  const remaining = slot === 1 ? 1 : 0;
  return json({ success: true, slot, remaining });
}

async function handleGetMyPicks(request, env) {
  const username = await getUsername(env, request);
  if (!username) return json({ error: 'Not authenticated' }, 401);

  const b1json = await env.PICKS_KV.get(`picks:${username}:1`);
  const b2json = await env.PICKS_KV.get(`picks:${username}:2`);
  const count  = (b1json ? 1 : 0) + (b2json ? 1 : 0);

  return json({
    brackets:  [b1json ? JSON.parse(b1json) : null, b2json ? JSON.parse(b2json) : null],
    count,
    remaining: MAX_BRACKETS_PER_USER - count,
    locked:    isLocked(),
  });
}

async function handleGetLeaderboard(env) {
  const resultsJson = await env.PICKS_KV.get('results');
  const results     = resultsJson ? JSON.parse(resultsJson) : null;
  const locked      = isLocked();

  const keys        = await env.PICKS_KV.list({ prefix: 'picks:' });
  const leaderboard = [];

  for (const { name } of keys.keys) {
    const parts = name.split(':'); // picks : username : slot
    if (parts.length !== 3) continue;

    const picksJson = await env.PICKS_KV.get(name);
    if (!picksJson) continue;
    const picks = JSON.parse(picksJson);

    const score     = calcScore(picks, results);
    const champDiff = results?.champScore != null && picks.champScore != null
      ? Math.abs(picks.champScore - results.champScore)
      : null;

    // Slot 1 shows as "username", slot 2 shows as "username (2)"
    const displayName = picks.slot === 2 ? `${picks.username} (2)` : picks.username;

    leaderboard.push({
      username:    picks.username,
      displayName,
      slot:        picks.slot,
      score,
      champScore:  locked ? picks.champScore : null,
      champDiff,
      picks:       locked ? picks.games : null,
      submittedAt: picks.submittedAt,
    });
  }

  leaderboard.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.champDiff != null && b.champDiff != null) return a.champDiff - b.champDiff;
    if (a.champDiff != null) return -1;
    if (b.champDiff != null) return 1;
    return 0;
  });

  return json({ leaderboard, results, locked });
}

async function handleSetResults(request, env) {
  const body = await request.json().catch(() => ({}));
  const { adminPassword, games, champScore } = body;

  if (!adminPassword || adminPassword !== env.ADMIN_PASSWORD) {
    return json({ error: 'Invalid admin password' }, 403);
  }

  await env.PICKS_KV.put('results', JSON.stringify({
    games:      games || {},
    champScore: champScore != null ? Math.round(Number(champScore)) : null,
    updatedAt:  new Date().toISOString(),
  }));

  return json({ success: true });
}

async function handleGetResults(env) {
  const resultsJson = await env.PICKS_KV.get('results');
  return json({
    results: resultsJson ? JSON.parse(resultsJson) : null,
    locked:  isLocked(),
  });
}

// ────────────────────────────────────────────────────────────
// ROUTER
// ────────────────────────────────────────────────────────────

export async function onRequest(context) {
  const { request, env } = context;
  const url    = new URL(request.url);
  const path   = url.pathname;
  const method = request.method;

  if (method === 'OPTIONS') return new Response(null, { status: 204 });

  try {
    if (path === '/api/register'    && method === 'POST') return handleRegister(request, env);
    if (path === '/api/login'       && method === 'POST') return handleLogin(request, env);
    if (path === '/api/picks'       && method === 'POST') return handleSubmitPicks(request, env);
    if (path === '/api/picks/me'    && method === 'GET')  return handleGetMyPicks(request, env);
    if (path === '/api/leaderboard' && method === 'GET')  return handleGetLeaderboard(env);
    if (path === '/api/results'     && method === 'POST') return handleSetResults(request, env);
    if (path === '/api/results'     && method === 'GET')  return handleGetResults(env);
    return json({ error: 'Not found' }, 404);
  } catch (err) {
    console.error(err);
    return json({ error: 'Internal server error' }, 500);
  }
}
