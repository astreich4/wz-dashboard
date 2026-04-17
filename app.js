const DEFAULT_COLORS = ['#7c5cfc', '#ff9100', '#00e676', '#ff4081'];
const STATS = ['kills','eliminations','assists','damage','redeploys'];

let PLAYERS = Array.isArray(CONFIG.PLAYERS) ? [...CONFIG.PLAYERS] : [];
let COLORS = [...DEFAULT_COLORS];
let sessions = [];
let dashView = 'all';
let currentTab = 'dashboard';

function normalizeHeader(v) {
  return String(v || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function parseNumber(v) {
  if (v === undefined || v === null || v === '') return 0;
  const cleaned = String(v).replace(/,/g, '').trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function parseWin(v) {
  const s = String(v || '').trim().toLowerCase();
  if (['yes', 'y', 'true', '1', 'win', 'w'].includes(s)) return true;
  if (['no', 'n', 'false', '0', 'loss', 'l'].includes(s)) return false;
  return null;
}

function parseDateToIso(v) {
  const raw = String(v || '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const slash = raw.replace(/\./g, '/').replace(/-/g, '/');
  const parts = slash.split('/').map(p => p.trim()).filter(Boolean);
  if (parts.length === 3) {
    let [m, d, y] = parts;
    if (y.length === 2) y = Number(y) >= 70 ? `19${y}` : `20${y}`;
    if (String(y).length === 4) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }
  const dt = new Date(raw);
  if (!Number.isNaN(dt.getTime())) {
    return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
  }
  return raw;
}

function calcScore(s) {
  return +(
    (s.kills * 3) +
    (s.eliminations * 2) +
    (s.assists * 1) +
    (s.damage / 100) +
    (s.redeploys * 1.5)
  ).toFixed(1);
}

function scoreBreakdown(s) {
  const parts = [];
  if (s.kills) parts.push(`K:+${(s.kills * 3).toFixed(0)}`);
  if (s.eliminations) parts.push(`E:+${(s.eliminations * 2).toFixed(0)}`);
  if (s.assists) parts.push(`A:+${s.assists}`);
  if (s.damage) parts.push(`D:+${(s.damage / 100).toFixed(1)}`);
  if (s.redeploys) parts.push(`R:+${(s.redeploys * 1.5).toFixed(1)}`);
  return parts.join('  ');
}

function statObjFromRecord(rec) {
  return {
    kills: parseNumber(rec.kills),
    eliminations: parseNumber(rec.eliminations),
    assists: parseNumber(rec.assists),
    damage: parseNumber(rec.damage),
    redeploys: parseNumber(rec.redeploys)
  };
}

function parseCsv(text) {
  if (typeof Papa !== 'undefined') {
    const parsed = Papa.parse(text.trim(), { skipEmptyLines: true });
    return parsed.data || [];
  }

  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
    } else if ((ch === '' || ch === '') && !inQuotes) {
      if (ch === '' && next === '') i += 1;
      row.push(cell);
      if (row.some(value => String(value).trim() !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }

  if (cell.length || row.length) {
    row.push(cell);
    if (row.some(value => String(value).trim() !== '')) rows.push(row);
  }

  return rows;
}

function getTabConfig() {
  return CONFIG.TAB || null;
}

async function fetchSheet() {
  const tab = getTabConfig();
  if (!tab || !CONFIG.SHEET_ID || !tab.gid) return [];

  const url = `https://docs.google.com/spreadsheets/d/${CONFIG.SHEET_ID}/export?format=csv&gid=${encodeURIComponent(tab.gid)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load tab "${tab.name || tab.gid}"`);
  }

  const csvText = await res.text();
  return parseCsv(csvText);
}

function rowsToObjects(rows) {
  if (!rows || rows.length < 2) return [];
  const headerMap = rows[0].map(normalizeHeader);
  return rows.slice(1)
    .filter(row => row.some(cell => String(cell || '').trim() !== ''))
    .map(row => {
      const obj = {};
      headerMap.forEach((key, i) => obj[key] = row[i] ?? '');
      return obj;
    });
}

function derivePlayers(records) {
  const seen = new Set();
  const found = [];
  records.forEach(rec => {
    const name = String(rec.player || '').trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      found.push(name);
    }
  });
  const configured = Array.isArray(CONFIG.PLAYERS) ? CONFIG.PLAYERS.filter(Boolean) : [];
  const merged = [...configured];
  found.forEach(name => {
    if (!merged.includes(name)) merged.push(name);
  });
  return merged.length ? merged : found;
}

function transformGames(rows) {
  const records = rowsToObjects(rows);
  PLAYERS = derivePlayers(records);
  COLORS = PLAYERS.map((_, i) => DEFAULT_COLORS[i % DEFAULT_COLORS.length]);

  const grouped = new Map();

  records.forEach((rec, idx) => {
    const gameId = String(rec.gameid || rec.game || rec.matchid || idx).trim() || String(idx);
    const date = parseDateToIso(rec.date);
    const key = `${date}__${gameId}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        date,
        mode: String(rec.gametype || rec.mode || rec.playlist || 'Warzone').trim() || 'Warzone',
        notes: String(rec.notes || '').trim(),
        win: parseWin(rec.win),
        gameId,
        playerMap: new Map()
      });
    }
    const game = grouped.get(key);
    const playerName = String(rec.player || '').trim();
    game.playerMap.set(playerName, statObjFromRecord(rec));
    if (game.win === null) game.win = parseWin(rec.win);
  });

  const transformed = [...grouped.values()].map(game => ({
    date: game.date,
    mode: game.mode,
    notes: game.notes,
    win: game.win,
    gameId: game.gameId,
    players: PLAYERS.map(name => game.playerMap.get(name) || statObjFromRecord({}))
  }));

  transformed.sort((a, b) => {
    const ad = new Date(a.date || '1900-01-01').getTime();
    const bd = new Date(b.date || '1900-01-01').getTime();
    if (ad !== bd) return bd - ad;
    return String(a.gameId).localeCompare(String(b.gameId), undefined, { numeric: true, sensitivity: 'base' });
  });

  return transformed;
}


function aggPlayer(playerIdx) {
  const agg = { kills:0, eliminations:0, assists:0, damage:0, redeploys:0, score:0 };
  sessions.forEach(sess => {
    const s = sess.players[playerIdx] || statObjFromRecord({});
    STATS.forEach(k => agg[k] += s[k] || 0);
    agg.score += calcScore(s);
  });
  agg.score = +agg.score.toFixed(1);
  return agg;
}

function teamAgg() {
  const agg = { kills:0, eliminations:0, assists:0, damage:0, redeploys:0, score:0 };
  sessions.forEach(sess => {
    sess.players.forEach(s => {
      STATS.forEach(k => agg[k] += s[k] || 0);
      agg.score += calcScore(s);
    });
  });
  agg.score = +agg.score.toFixed(1);
  return agg;
}

function getUniqueDates() {
  const seen = new Set();
  return sessions
    .map(s => s.date || '')
    .filter(d => {
      if (!d || seen.has(d)) return false;
      seen.add(d);
      return true;
    })
    .sort((a,b) => new Date(b) - new Date(a));
}

function getSessionsByDate(date) {
  return sessions.filter(s => s.date === date);
}

function aggByDate(date, playerIdx) {
  const subset = getSessionsByDate(date);
  const agg = { kills:0, eliminations:0, assists:0, damage:0, redeploys:0, score:0 };
  subset.forEach(sess => {
    const s = sess.players[playerIdx] || statObjFromRecord({});
    STATS.forEach(k => agg[k] += s[k] || 0);
    agg.score += calcScore(s);
  });
  agg.score = +agg.score.toFixed(1);
  return agg;
}

function teamAggByDate(date) {
  const subset = getSessionsByDate(date);
  const agg = { kills:0, eliminations:0, assists:0, damage:0, redeploys:0, score:0 };
  subset.forEach(sess => {
    sess.players.forEach(s => {
      STATS.forEach(k => agg[k] += s[k] || 0);
      agg.score += calcScore(s);
    });
  });
  agg.score = +agg.score.toFixed(1);
  return agg;
}

function fmtDate(dateStr, opts) {
  if (!dateStr) return '—';
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', opts || {month:'short', day:'numeric'});
}

function renderToggle() {
  const el = document.getElementById('session-toggle');
  if (!el) return;
  const dates = getUniqueDates();
  el.innerHTML = `
    <button class="stoggle-btn ${dashView === 'all' ? 'active-all' : ''}" onclick="setDashView('all')">📊 All Time</button>
    ${dates.map(date => {
      const count = getSessionsByDate(date).length;
      const label = fmtDate(date, {weekday:'short', month:'short', day:'numeric'});
      return `<button class="stoggle-btn ${dashView === date ? 'active' : ''}" onclick="setDashView('${date}')">
        📅 ${label}${count > 1 ? ` <span style="opacity:0.6;font-size:0.7rem;">(${count} games)</span>` : ''}
      </button>`;
    }).join('')}
  `;
}

function setDashView(view) {
  dashView = view;
  renderDashboard();
}

function renderDashboard() {
  const hasSessions = sessions.length > 0;
  document.getElementById('dash-empty').style.display = hasSessions ? 'none' : 'block';
  renderToggle();

  const isAll = dashView === 'all';
  const activeDate = !isAll ? dashView : null;

  const getAgg = (playerIdx) => isAll ? aggPlayer(playerIdx) : aggByDate(activeDate, playerIdx);
  const getTeam = () => isAll ? teamAgg() : teamAggByDate(activeDate);

  const dateCount = !isAll ? getSessionsByDate(activeDate).length : 0;
  const viewLabel = isAll
    ? `All Time (${sessions.length} game${sessions.length !== 1 ? 's' : ''})`
    : `${fmtDate(activeDate, {weekday:'long', month:'long', day:'numeric', year:'numeric'})}${dateCount > 1 ? ` — ${dateCount} Games Combined` : ''}`;

  document.getElementById('dash-team-title').textContent = 'Team Performance · ' + viewLabel;
  document.getElementById('dash-standings-title').textContent = 'Player Standings · ' + viewLabel;

  const t = getTeam();
  const sessCnt = isAll ? sessions.length : dateCount;
  const noData = sessCnt === 0;
  document.getElementById('ts-sessions').textContent  = noData ? '—' : sessCnt;
  document.getElementById('ts-sessions-lbl').textContent = sessCnt === 1 ? 'Game' : 'Games';
  const activeSessions = isAll ? sessions : getSessionsByDate(activeDate);
  const winCount = activeSessions.filter(s => s.win === true).length;
  const lossCount = activeSessions.filter(s => s.win === false).length;
  const totalGames = activeSessions.length;
  const winPct = totalGames ? Math.round(winCount / totalGames * 100) : 0;

  document.getElementById('wins-hero-count').textContent = noData ? '—' : winCount;
  document.getElementById('wins-hero-sub').textContent = noData ? 'no games loaded' : `of ${totalGames} game${totalGames !== 1 ? 's' : ''}`;
  document.getElementById('wins-hero-w').textContent = noData ? '—' : winCount;
  document.getElementById('wins-hero-l').textContent = noData ? '—' : lossCount;
  document.getElementById('wins-hero-pct').textContent = noData ? '—' : winPct + '%';
  document.getElementById('wins-hero-bar').style.width = noData ? '0%' : winPct + '%';

  document.getElementById('ts-kills').textContent     = noData ? '—' : t.kills.toLocaleString();
  document.getElementById('ts-elims').textContent     = noData ? '—' : t.eliminations.toLocaleString();
  document.getElementById('ts-assists').textContent   = noData ? '—' : t.assists.toLocaleString();
  document.getElementById('ts-damage').textContent    = noData ? '—' : t.damage.toLocaleString();
  document.getElementById('ts-redeploys').textContent = noData ? '—' : t.redeploys.toLocaleString();
  document.getElementById('ts-score').textContent     = noData ? '—' : t.score.toLocaleString();

  const aggs = PLAYERS.map((_, i) => getAgg(i));
  const ranking = aggs.map((agg, i) => ({ agg, i })).sort((a,b) => b.agg.score - a.agg.score);
  const rankOf = {};
  ranking.forEach((row, idx) => rankOf[row.i] = idx + 1);

  document.getElementById('player-cards').innerHTML = aggs.map((agg, i) => {
    const rank = rankOf[i];
    const rankEmoji = ['🥇','🥈','🥉','4️⃣'][rank - 1] || '🏅';
    const scoreLabel = isAll ? 'Total Score' : 'Day Score';
    return `
      <div class="player-card" data-player="${i}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div><div class="player-name">${PLAYERS[i]}</div></div>
          <div style="text-align:right">
            <div class="player-score-big text-accent">${agg.score}</div>
            <div class="player-score-label">${scoreLabel}</div>
          </div>
        </div>
        <div class="stat-mini-grid">
          <div class="stat-mini"><div class="stat-mini-val text-green">${agg.kills}</div><div class="stat-mini-lbl">Kills</div></div>
          <div class="stat-mini"><div class="stat-mini-val text-yellow">${agg.eliminations}</div><div class="stat-mini-lbl">Elims</div></div>
          <div class="stat-mini"><div class="stat-mini-val">${agg.assists}</div><div class="stat-mini-lbl">Assists</div></div>
          <div class="stat-mini"><div class="stat-mini-val">${agg.damage.toLocaleString()}</div><div class="stat-mini-lbl">Damage</div></div>
          <div class="stat-mini"><div class="stat-mini-val">${agg.redeploys}</div><div class="stat-mini-lbl">Redeploys</div></div>
        </div>
        <div style="margin-top:10px;font-size:0.75rem;color:var(--text-muted);">${rankEmoji} Rank #${rank} ${isAll ? 'overall' : 'this day'}</div>
      </div>
    `;
  }).join('');

  renderBarChart('score-chart',   aggs.map((a,i) => ({label: PLAYERS[i], val: a.score, color: COLORS[i]})));
  renderBarChart('kills-chart',   aggs.map((a,i) => ({label: PLAYERS[i], val: a.kills, color: COLORS[i]})));
  renderBarChart('damage-chart',  aggs.map((a,i) => ({label: PLAYERS[i], val: a.damage, color: COLORS[i]})));
  renderBarChart('assists-chart', aggs.map((a,i) => ({label: PLAYERS[i], val: a.assists, color: COLORS[i]})));
}

function renderBarChart(containerId, data) {
  const max = Math.max(...data.map(d => d.val), 1);
  document.getElementById(containerId).innerHTML = data
    .slice().sort((a,b) => b.val - a.val)
    .map(d => `
      <div class="chart-bar-row">
        <div class="chart-bar-label">${d.label}</div>
        <div class="chart-bar-track">
          <div class="chart-bar-fill" style="width:${(d.val/max*100).toFixed(1)}%;background:${d.color};">
            <span class="chart-bar-val">${typeof d.val === 'number' ? d.val.toLocaleString() : d.val}</span>
          </div>
        </div>
      </div>
    `).join('');
}

function renderHistory() {
  const el = document.getElementById('history-list');
  const filterEl = document.getElementById('history-date-filter');
  const selected = filterEl ? filterEl.value : 'all';
  const allDates = getUniqueDates();

  if (filterEl) {
    filterEl.innerHTML = `<option value="all">All Dates</option>` +
      allDates.map(d => `<option value="${d}" ${selected === d ? 'selected' : ''}>${fmtDate(d, {weekday:'short', month:'short', day:'numeric', year:'numeric'})}</option>`).join('');
  }

  const activeFilter = filterEl ? filterEl.value : 'all';
  if (!sessions.length) {
    el.innerHTML = `<div class="empty-state"><div class="big-icon">📋</div><p>No games found yet.</p></div>`;
    return;
  }

  const dates = activeFilter === 'all' ? allDates : allDates.filter(d => d === activeFilter);
  const dayNum = allDates.length;

  if (!dates.length) {
    el.innerHTML = `<div class="empty-state"><div class="big-icon">📅</div><p>No sessions found for that date.</p></div>`;
    return;
  }

  el.innerHTML = dates.map((date, di) => {
    const daySessions = getSessionsByDate(date);
    const dateLabel = fmtDate(date, {weekday:'long', month:'long', day:'numeric', year:'numeric'});
    const gamesLabel = daySessions.length === 1 ? '1 game' : `${daySessions.length} games`;

    const dayAggs = PLAYERS.map((_, i) => aggByDate(date, i));
    const ranked = dayAggs.map((agg, i) => ({ i, agg })).sort((a,b) => b.agg.score - a.agg.score);
    const rankOf = {};
    ranked.forEach((r, ri) => rankOf[r.i] = ri + 1);

    const rankClass = i => rankOf[i] === 1 ? 'best-player' : rankOf[i] === PLAYERS.length ? 'worst-player' : '';
    const labels = ['🥇 MVP','🥈 2nd','🥉 3rd','💀 4th'];
    const rankBadge = i => `<span class="rank-badge rank-${Math.min(rankOf[i],4)}">${labels[rankOf[i]-1] || `#${rankOf[i]}`}</span>`;

    const mvp = ranked[0];
    const weak = ranked[ranked.length - 1];
    const mvpLines = ['🔥 Absolute beast mode','🎯 Carrying the squad','💪 Statistically the powerhouse','⚡ Top performer of the day','🏆 Day MVP'];
    const weakLines = ['😬 Rough day overall','🥺 Needs some target practice','😅 Room to improve','💀 Struggled this session','🎮 Better luck next time'];
    const mvpMsg = mvpLines[di % mvpLines.length];
    const weakMsg = weakLines[di % weakLines.length];
    const sentiment = `
      <span class="sentiment-mvp">🥇 Day MVP: ${PLAYERS[mvp.i]}</span> — ${mvpMsg}
      (Score: ${mvp.agg.score}, Kills: ${mvp.agg.kills}, Damage: ${mvp.agg.damage.toLocaleString()})
      <br><br>
      <span class="sentiment-weak">📉 Weakest: ${PLAYERS[weak.i]}</span> — ${weakMsg}
      (Score: ${weak.agg.score}, Kills: ${weak.agg.kills}, Damage: ${weak.agg.damage.toLocaleString()})
      <br><br>
      <span style="color:var(--text-muted);font-size:0.82rem;">
        Full ranking: ${ranked.map((r,ri) => `${ri+1}. ${PLAYERS[r.i]} (${r.agg.score}pts)`).join(' → ')}
      </span>
    `;

    return `
      <div class="session-item">
        <div class="session-header">
          <div>
            <div class="session-title">📅 ${dateLabel}</div>
            <div class="session-date">${gamesLabel} · Day ${dayNum - di} of ${dayNum}</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            ${(() => {
              const wins = daySessions.filter(s => s.win === true).length;
              const losses = daySessions.filter(s => s.win === false).length;
              return `
                ${wins > 0 ? `<span style="background:rgba(0,230,118,0.15);color:#00e676;font-weight:700;font-size:0.8rem;padding:4px 12px;border-radius:20px;border:1px solid rgba(0,230,118,0.3);">🏆 ${wins}W</span>` : ''}
                ${losses > 0 ? `<span style="background:rgba(255,68,68,0.1);color:#ff4444;font-weight:700;font-size:0.8rem;padding:4px 12px;border-radius:20px;border:1px solid rgba(255,68,68,0.2);">💀 ${losses}L</span>` : ''}
                <span class="session-num">${gamesLabel}</span>
              `;
            })()}
          </div>
        </div>

        <table class="session-table">
          <thead>
            <tr>
              <th>Player</th><th>Kills</th><th>Elims</th><th>Assists</th><th>Damage</th><th>Redeploys</th><th>Day Score</th><th>Rank</th>
            </tr>
          </thead>
          <tbody>
            ${PLAYERS.map((name, i) => {
              const agg = dayAggs[i];
              return `
                <tr class="${rankClass(i)}">
                  <td><strong>${name}</strong></td>
                  <td class="text-green">${agg.kills}</td>
                  <td class="text-yellow">${agg.eliminations}</td>
                  <td>${agg.assists}</td>
                  <td>${agg.damage.toLocaleString()}</td>
                  <td>${agg.redeploys}</td>
                  <td class="text-accent"><strong>${agg.score}</strong><div class="points-breakdown">${scoreBreakdown(agg)}</div></td>
                  <td>${rankBadge(i)}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>

        <div class="sentiment-box">${sentiment}</div>

        <div style="margin-top:14px;">
          <button
            class="btn btn-primary"
            style="width:100%;padding:12px;font-size:0.88rem;letter-spacing:0.5px;"
            onclick="toggleReport('report-${date}', this)">
            📝 Generate Match Report
          </button>
          <div id="report-${date}" style="display:none;margin-top:12px;
            background: linear-gradient(135deg, rgba(0,212,255,0.05), rgba(124,92,252,0.05));
            border: 1px solid rgba(0,212,255,0.2);
            border-radius: 10px;
            padding: 16px 18px;">
            <div style="font-size:0.72rem;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--accent2);margin-bottom:10px;">📝 Match Report</div>
            <div style="font-size:0.85rem;line-height:1.75;color:var(--text);">${generateWriteup(dayAggs, ranked, daySessions.length)}</div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function generateWriteup(dayAggs, ranked, gamesCount) {
  const seed = Math.round(ranked.reduce((a,r) => a + r.agg.score, 0));
  const openings = [
    `Another session in the books. The stats don't lie, and unfortunately for some of you, neither does this report.`,
    `Witnesses have confirmed it happened. The numbers have been crunched. Here's what went down.`,
    `The dust has settled, the lobby has emptied, and someone owes the squad an apology. Let's get into it.`,
    `Every squad has a carry and a passenger. This session was no different. You know who you are.`,
    `The scorecard has been reviewed, the evidence examined. Court is now in session.`,
    `Filed under: things that occurred. A full breakdown of who showed up and who just… showed up.`,
  ];
  const opening = openings[seed % openings.length];
  const rankEmojis = ['🥇', '🥈', '🥉', '💀'];

  function playerLine(r, ri) {
    const name = PLAYERS[r.i];
    const s = r.agg;
    const rank = ri + 1;
    const emoji = rankEmojis[ri] || '🏅';
    if (rank === 1) {
      if (s.kills >= 6) return `${emoji} <strong>${name}</strong> went absolutely feral — ${s.kills} kills and ${s.damage.toLocaleString()} damage. MVP, undisputed.`;
      if (s.damage >= 3000) return `${emoji} <strong>${name}</strong> didn't come to play, they came to demolish. ${s.damage.toLocaleString()} damage and ${s.kills} kills. MVP.`;
      return `${emoji} <strong>${name}</strong> claimed the top spot with ${s.score} points, ${s.kills} kills, and ${s.damage.toLocaleString()} damage.`;
    }
    if (rank === 2) {
      if (s.assists >= 3) return `${emoji} <strong>${name}</strong> finished second with ${s.score} pts and real team IQ — ${s.assists} assists prove it.`;
      if (s.damage >= 2000) return `${emoji} <strong>${name}</strong> came in second with ${s.damage.toLocaleString()} damage dealt. Very respectable showing.`;
      return `${emoji} <strong>${name}</strong> grabbed second place with ${s.score} pts. Consistent and reliable.`;
    }
    if (rank === 3) {
      if (s.redeploys >= 3) return `${emoji} <strong>${name}</strong> came in third — not flashy, but ${s.redeploys} redeploys say they were looking out for the team.`;
      return `${emoji} <strong>${name}</strong> took third with ${s.kills} kills and ${s.damage.toLocaleString()} damage.`;
    }
    if (s.kills === 0 && s.damage < 200) return `${emoji} <strong>${name}</strong> finished last with ${s.damage} damage and zero kills. There is nowhere to go but up.`;
    return `${emoji} <strong>${name}</strong> wrapped up last with ${s.score} pts and ${s.damage.toLocaleString()} damage. Tomorrow is another lobby.`;
  }

  return `
    <p style="margin-bottom:12px;">${opening}</p>
    <p style="margin-bottom:12px;">Across <strong>${gamesCount}</strong> ${gamesCount === 1 ? 'game' : 'games'}, the squad stacked up <strong>${dayAggs.reduce((sum, s) => sum + s.kills, 0)}</strong> kills and <strong>${dayAggs.reduce((sum, s) => sum + s.damage, 0).toLocaleString()}</strong> damage.</p>
    <div style="display:grid;gap:10px;">
      ${ranked.map((r, ri) => `<div>${playerLine(r, ri)}</div>`).join('')}
    </div>
  `;
}

function renderLeaderboard() {
  const aggs = PLAYERS.map((name, i) => ({ name, color: COLORS[i], ...aggPlayer(i) }));
  renderLB('lb-score', aggs, p => p.score, p => `${p.kills} kills · ${p.damage.toLocaleString()} damage`, false);
  renderLB('lb-kills', aggs, p => p.kills, p => `${p.eliminations} elims · ${p.score} pts`, false);
  renderLB('lb-damage', aggs, p => p.damage, p => `${sessions.length ? Math.round(p.damage / sessions.length).toLocaleString() : 0} avg dmg/game`, false);
  renderLB('lb-assists', aggs, p => p.assists, p => `${p.redeploys} redeploys`, false);

  const totalGames = sessions.length;
  const totalWins = sessions.filter(s => s.win === true).length;
  const winPct = totalGames ? Math.round(totalWins / totalGames * 100) : 0;
  document.getElementById('lb-wins').innerHTML = !sessions.length
    ? '<div style="color:var(--text-muted);font-size:0.85rem;padding:10px;">Load games to see win rate</div>'
    : `<div class="leaderboard-row" style="justify-content:center;flex-direction:column;gap:6px;text-align:center;">
        <div style="font-size:2.5rem;font-weight:900;color:var(--green);">${winPct}%</div>
        <div style="font-size:0.85rem;color:var(--text-muted);">${totalWins} win${totalWins!==1?'s':''} out of ${totalGames} game${totalGames!==1?'s':''}</div>
        <div style="width:100%;height:10px;background:var(--surface);border-radius:5px;margin-top:6px;overflow:hidden;">
          <div style="height:100%;width:${winPct}%;background:linear-gradient(90deg,#00e676,#00bcd4);border-radius:5px;transition:width 0.6s ease;"></div>
        </div>
      </div>`;

  const mvpCount = {};
  PLAYERS.forEach(p => mvpCount[p] = 0);
  sessions.forEach(sess => {
    const scored = sess.players.map((s, i) => ({ name: PLAYERS[i], score: calcScore(s) }));
    scored.sort((a, b) => b.score - a.score);
    if (scored[0]) mvpCount[scored[0].name]++;
  });
  const mvpData = PLAYERS.map((name, i) => ({ name, color: COLORS[i], mvp: mvpCount[name] }))
    .sort((a,b) => b.mvp - a.mvp);
  renderLBCustom('lb-mvp', mvpData, p => `${p.mvp} MVPs`, p => `out of ${sessions.length} games`);
}

function renderLB(id, data, valFn, subFn, lowBetter) {
  const sorted = data.slice().sort((a,b) => lowBetter ? valFn(a) - valFn(b) : valFn(b) - valFn(a));
  const medals = ['🥇','🥈','🥉','4️⃣'];
  document.getElementById(id).innerHTML = !sessions.length
    ? '<div style="color:var(--text-muted);font-size:0.85rem;padding:10px;">Load games to see leaderboard</div>'
    : sorted.map((p,ri) => `
      <div class="leaderboard-row">
        <div class="lb-rank" style="color:${p.color}">${medals[ri] || '🏅'}</div>
        <div>
          <div class="lb-name">${p.name}</div>
          <div class="lb-stats">${subFn(p)}</div>
        </div>
        <div class="lb-score" style="color:${p.color}">${valFn(p).toLocaleString()}</div>
      </div>
    `).join('');
}

function renderLBCustom(id, sorted, valFn, subFn) {
  const medals = ['🥇','🥈','🥉','4️⃣'];
  document.getElementById(id).innerHTML = !sessions.length
    ? '<div style="color:var(--text-muted);font-size:0.85rem;padding:10px;">Load games to see leaderboard</div>'
    : sorted.map((p,ri) => `
      <div class="leaderboard-row">
        <div class="lb-rank" style="color:${p.color}">${medals[ri] || '🏅'}</div>
        <div>
          <div class="lb-name">${p.name}</div>
          <div class="lb-stats">${subFn(p)}</div>
        </div>
        <div class="lb-score" style="color:${p.color}">${valFn(p)}</div>
      </div>
    `).join('');
}

function switchTab(name, btnEl) {
  currentTab = name;
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  if (btnEl) btnEl.classList.add('active');

  if (name === 'history') renderHistory();
  if (name === 'leaderboard') renderLeaderboard();
  if (name === 'dashboard') renderDashboard();
}

function toggleReport(id, btn) {
  const el = document.getElementById(id);
  const isHidden = el.style.display === 'none';
  el.style.display = isHidden ? 'block' : 'none';
  btn.textContent = isHidden ? '📝 Hide Match Report' : '📝 Generate Match Report';
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}

function setHeaderStatus(text) {
  const el = document.getElementById('header-sub');
  if (el) el.textContent = text;
  if (CONFIG.TITLE) document.title = CONFIG.TITLE;
}

async function loadData(showMessage = false) {
  try {
    setHeaderStatus('Loading Google Sheet data…');
    const gamesRows = await fetchSheet('games');
    sessions = transformGames(gamesRows);

    try {
    } catch {
          }

    renderAll();
    setHeaderStatus(PLAYERS.join(' · '));
    if (showMessage) showToast(`Loaded ${sessions.length} game${sessions.length !== 1 ? 's' : ''} from the public sheet ✅`);
  } catch (err) {
    console.error(err);
    sessions = [];
        renderAll();
    setHeaderStatus('Unable to load sheet data');
    document.getElementById('history-list').innerHTML = `
      <div class="card">
        <div class="card-title">Connection Error</div>
        <div style="font-size:0.9rem;line-height:1.7;color:var(--text-muted);">
          <div style="margin-bottom:10px;">${err.message}</div>
          <div>Check <strong>config.js</strong>, confirm the sheet is public, and make sure each tab's <strong>gid</strong> is correct.</div>
        </div>
      </div>`;
    showToast('Could not load Google Sheets data');
  }
}

function renderAll() {
  renderDashboard();
  renderHistory();
  renderLeaderboard();
}

loadData();
