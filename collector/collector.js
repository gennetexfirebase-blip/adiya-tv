// COREX TV collector: run on an open hltv.org page (DevTools console or a userscript).
// On a /matches/<id>/... page it pushes that match's scoreboard, log and radar every 2.5 s (only when something changed).
// On any other hltv.org page it pushes the live-match list every 10 s.
// Settings live in localStorage, never in this file:
//   localStorage.FB_CFG = JSON.stringify({url:"https://<ref>.supabase.co", anonKey:"<anon key>", writerKey:"<writer key>"})
(() => {
  const cfg = JSON.parse(localStorage.FB_CFG || '{}');
  if (!cfg.url || !cfg.anonKey || !cfg.writerKey) return console.warn('COREX TV: FB_CFG missing');
  const T = x => x ? x.textContent.replace(/\s+/g, ' ').trim() : '';
  const H = { apikey: cfg.anonKey, Authorization: 'Bearer ' + cfg.anonKey, 'x-fb-key': cfg.writerKey };
  const put = (k, v) => fetch(cfg.url + '/rest/v1/live?on_conflict=k', {
    method: 'POST',
    headers: { ...H, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ k, v, at: new Date().toISOString() })
  });
  const del = k => fetch(cfg.url + '/rest/v1/live?k=eq.' + encodeURIComponent(k), { method: 'DELETE', headers: H });

  // per-map results in team1/team2 order. HLTV does not update this block live, so the page is re-read every 45 s
  // and whenever the map changes; finished maps then carry their final score.
  const readMaps = doc => [...doc.querySelectorAll('.mapholder')].map(mh => {
    const l = mh.querySelector('.results-left'), r = mh.querySelector('.results-right');
    return { n: T(mh.querySelector('.mapname')), s1: T(l?.querySelector('.results-team-score')), s2: T(r?.querySelector('.results-team-score')),
      w: l?.classList.contains('won') ? 1 : r?.classList.contains('won') ? 2 : 0,
      pick: l?.classList.contains('pick') ? 1 : r?.classList.contains('pick') ? 2 : 0,
      half: T(mh.querySelector('.results-center-half-score')) };
  });
  const refreshMaps = async () => {
    try {
      const html = await fetch(location.pathname, { cache: 'no-store' }).then(r => r.text());
      window.__fbMaps = readMaps(new DOMParser().parseFromString(html, 'text/html'));
    } catch (e) {}
  };

  function snap() {
    const se = document.getElementById('scoreboardElement'); if (!se) return null;
    const top = document.querySelector('.scoreboard .topbarBg');
    const teams = [...document.querySelectorAll('.scoreboard table.team')].map(t => ({
      name: T(t.querySelector('.teamName')),
      side: /ctTeam/.test(t.querySelector('thead')?.className || '') ? 'CT' : 'T',
      players: [...t.querySelectorAll('tbody tr.player')].map(r => {
        const c = k => T(r.querySelector('.' + k)); const wi = r.querySelector('.weaponCell img');
        return { n: c('nameCell'), dead: r.className.includes('Dead'), hp: c('hp-text'),
          w: wi ? (wi.getAttribute('src') || '').split('/').pop().replace('.png', '') : '',
          arm: !!r.querySelector('.armorCell img'), kit: !!r.querySelector('.defuseKit img'),
          $: c('moneyCell'), k: c('killCell'), a: c('assistCell'), d: c('deathCell'), adr: c('adrCell') };
      })
    }));
    const log = [...document.querySelectorAll('.gamelog .gamelogBox')].slice(0, 30).map(b => {
      const c = b.cloneNode(true);
      c.querySelectorAll('img').forEach(i => {
        const s = (i.getAttribute('src') || '').split('/').pop().replace(/\.(png|svg)$/, '');
        i.replaceWith(i.classList.contains('playerWeapon') ? ' [' + s + '] ' : i.classList.contains('kill-attribute') ? ' (' + s + ') ' : '');
      });
      const k = b.classList.contains('playerKill') ? 'kill'
        : b.className.includes('winner') ? (b.className.includes('TERRORIST') && !b.className.includes('CT') ? 'roundT' : 'roundCT')
        : b.className.includes('bombPlant') ? 'plant' : b.className.includes('bombDefused') ? 'defuse'
        : b.className.includes('roundStart') ? 'start' : 'other';
      return [k, T(c), [...c.querySelectorAll('.tplayer,.ctplayer')].map(s => [s.classList.contains('tplayer') ? 'T' : 'CT', T(s)])];
    });
    const wo = document.querySelector('.win-o-meter');
    const prob = wo ? { t1: T(wo.querySelectorAll('.win-o-meter-team')[0]), t2: T(wo.querySelectorAll('.win-o-meter-team')[1]),
      ot: T(wo.querySelector('.offset-ot-2')), otl: T(wo.querySelector('.offset-ot-1')) } : null;
    const streams = [...document.querySelectorAll('.streams .stream-box')].filter(s => !s.classList.contains('hltv-live')).map(s => ({
      name: T(s.querySelector('.stream-box-embed')), flag: s.querySelector('.stream-flag')?.title || '',
      viewers: +T(s.querySelector('.viewers.gtSmartphone-only')) || 0, prov: s.dataset.streamProvider || '',
      url: s.querySelector('.external-stream a')?.href || '' })).filter(s => s.url);
    const mc = document.querySelector('.gamelog-2d-mini-map-map-container'); let radar = null;
    if (mc) {
      const r = mc.getBoundingClientRect(); const mm = document.querySelector('.gamelog-2d-mini-map');
      radar = { map: ((mm && mm.className.match(/de_(\w+)/)) || [])[1] || '',
        kills: [...mc.querySelectorAll('.gamelog-2d-killfeed-cross')].map(x => {
          const L = parseFloat(x.style.left) || 0, Tp = parseFloat(x.style.top) || 0, s = x.getBoundingClientRect().width || 8;
          return [x.classList.contains('terrorist') ? 'T' : 'CT', +((L + s / 2) / r.width).toFixed(4), +((Tp + s / 2) / r.height).toFixed(4), x.classList.contains('fading') ? 1 : 0];
        }) };
    }
    const maps = window.__fbMaps || readMaps(document);
    const fc = sel => ((document.querySelector(sel)?.getAttribute('src') || '').match(/flags\/\d+x\d+\/(\w+)\./) || [])[1] || '';
    const vb = [...document.querySelectorAll('.veto-box')];
    const lineups = [...document.querySelectorAll('.lineups .lineup')].map(lu => {
      const seen = new Set();
      return { hltv: T(lu.querySelector('.hltv-ranking')).replace('HLTV:', '').trim(), vrs: T(lu.querySelector('.vrs-ranking')).replace('VRS:', '').trim(),
        players: [...lu.querySelectorAll('.player-compare')].map(pc => ({ id: +pc.dataset.playerId, nick: (pc.querySelector('img')?.title || '').match(/'([^']+)'/)?.[1] || T(pc) }))
          .filter(p => p.id && !seen.has(p.id) && seen.add(p.id)) };
    });
    const history = [...document.querySelectorAll('.scoreboard .roundHistory > div')].map(h => [...h.querySelectorAll('.roundHistoryLine')].map(l =>
      [/CT/.test(l.className) ? 'CT' : 'T', [...l.querySelectorAll('.historyIcon img')].map(i => (i.getAttribute('src') || '').split('/').pop().replace(/\.(svg|png)$/, '').replace('emptyHistory', ''))]));
    return { id: +se.dataset.scorebotId, maps, history, f1: fc('.teamsBox img.team1'), f2: fc('.teamsBox img.team2'), lineups,
      info: T(vb[0]), veto: vb[1] ? [...vb[1].querySelectorAll('div > div')].map(T).filter(x => /^\d\./.test(x) && !/\d\..*\d\./.test(x)) : [], t1: se.dataset.team1Name, t2: se.dataset.team2Name,
      round: T(top?.querySelector('.currentRoundText')), ct: T(top?.querySelector('.ctScore')), t: T(top?.querySelector('.tScore')),
      clock: T(top?.querySelector('.timeText')), teams, log, prob, streams, radar, updated: new Date().toISOString() };
  }

  // Event pages: capture the rendered bracket / group tables (structure-agnostic) plus any JSON HLTV embeds,
  // so the site can redraw them. Sent as row 'e:<eventId>'.
  const captureEvent = (doc, eid) => {
    const clean = el => { const c = el.cloneNode(true);
      c.querySelectorAll('script,style,svg,noscript').forEach(x => x.remove());
      c.querySelectorAll('img').forEach(i => { const src = i.getAttribute('src') || ''; [...i.attributes].forEach(a => i.removeAttribute(a.name)); i.setAttribute('data-src', src); i.setAttribute('alt', ''); });
      c.querySelectorAll('*').forEach(x => [...x.attributes].forEach(a => { if (!/^(class|href|data-[\w-]+|title)$/.test(a.name)) x.removeAttribute(a.name); }));
      return c.outerHTML.replace(/\s+/g, ' '); };
    const heads = [...doc.querySelectorAll('h2,h3,.headline,.standard-headline,.bracket-headline')].filter(h => /bracket|group|playoff|elimination|swiss|stage/i.test(h.textContent));
    const blocks = [...new Set(heads.map(h => h.closest('.standard-box, section, .bracket-container, .groups-container, .event-bracket') || h.parentElement))].slice(0, 8);
    const jsons = [...doc.querySelectorAll('*')].flatMap(el => [...el.attributes].filter(a => /json|bracket/i.test(a.name) && a.value.length > 50).map(a => ({ tag: el.className || el.tagName, attr: a.name, value: a.value.slice(0, 120000) }))).slice(0, 6);
    return { id: eid, blocks: blocks.map(clean).map(h => h.slice(0, 150000)), jsons, updated: new Date().toISOString() };
  };
  // ---- event brackets from HLTV's own bracket JSON (data-slotted-bracket-json): compact rounds/slots for the site
  const LANE = k => /^upper/i.test(k) ? 'up' : /^lower/i.test(k) ? 'lo' : /^grand/i.test(k) ? 'gf' : /^consol/i.test(k) ? 'cf' : '';
  const slotTeam = t => !t ? null : /Known/.test(t.type || '') ? { id: t.id?.teamId || 0, name: t.name || '', logo: t.logo?.dayLogoURL || '' }
    : { id: 0, name: t.description || 'TBD', logo: '' };
  const parseBrackets = doc => [...doc.querySelectorAll('[data-slotted-bracket-json]')].map(el => {
    let j; try { j = JSON.parse(el.getAttribute('data-slotted-bracket-json')); } catch (e) { return null; }
    const rounds = [];
    const addRound = (r, lane) => {
      if (!r || typeof r !== 'object') return;
      const slots = Object.keys(r).filter(k => /^slot\d+$/.test(k)).sort((a, b) => +a.slice(4) - +b.slice(4)).map(k => r[k]).filter(s => s && !s.hidden).map(s => {
        const mu = s.matchup || {}, sc = mu.score;
        return { id: s.slotId?.id || '', mid: mu.match?.matchId || 0, time: mu.match?.startTime || 0, bo: mu.match?.numberOfMaps || 0,
          t: [slotTeam(mu.team1), slotTeam(mu.team2)], s: sc ? [sc.team1Score, sc.team2Score] : null, w: sc ? (sc.team1Winner ? 1 : 2) : 0,
          win: s.winnerType?.type || '', lose: s.loserType?.type || '' };
      });
      if (slots.length) rounds.push({ name: r.roundName?.name || '', lane, slots });
    };
    if (Array.isArray(j.rounds)) j.rounds.forEach(r => addRound(r, ''));
    else Object.keys(j).forEach(k => { if (j[k] && typeof j[k] === 'object' && (j[k].roundName || Object.keys(j[k]).some(x => /^slot\d+$/.test(x)))) addRound(j[k], LANE(k)); });
    return rounds.length ? { name: j.name || '', type: (j.type || '').split('.').pop(), rounds } : null;
  }).filter(Boolean);
  const pushBrackets = async (eid, path) => {
    try {
      const r = await fetch(path || '/events/' + eid + '/x', { cache: 'no-store' }); if (!r.ok) return 0;
      const b = parseBrackets(new DOMParser().parseFromString(await r.text(), 'text/html'));
      if (b.length) await put('e:' + eid, { id: eid, brk: b, updated: new Date().toISOString() });
      return b.length;
    } catch (e) { return 0; }
  };
  window.__fbPushBrackets = pushBrackets;
  // ---- team map stats: one HLTV stats request per team per 12 h (marked before the request, so a block is never retried) ----
  const TM_TTL = 12 * 3600e3;
  const ymd = d => d.toISOString().slice(0, 10);
  const parseMapStats = doc => {
    const out = [], seen = new Set();
    doc.querySelectorAll('.map-pool-map-name').forEach(nm => {
      const name = T(nm).replace(/\s*-\s*[\d.]+%\s*$/, '');
      if (!name || seen.has(name)) return;
      let box = nm.parentElement;
      while (box && box !== doc.body && !box.querySelector('.stats-row')) box = box.parentElement;
      if (!box || box === doc.body) return;
      const rows = {};
      box.querySelectorAll('.stats-row').forEach(r => { const s = r.querySelectorAll('span'); if (s.length >= 2) rows[T(s[0]).toLowerCase()] = T(s[s.length - 1]); });
      const wdl = (rows['wins / draws / losses'] || '').split('/').map(x => parseInt(x, 10));
      if (wdl.length !== 3 || wdl.some(isNaN)) return;
      seen.add(name);
      out.push({ n: name, w: wdl[0], d: wdl[1], l: wdl[2], wr: rows['win rate'] || '',
        fk: rows['round win-% after getting first kill'] || '', fd: rows['round win-% after receiving first death'] || '' });
    });
    return out;
  };
  const pushTeamMaps = async (tid, slug) => {
    const key = 'corexTm:' + tid;
    if (Date.now() - (+localStorage[key] || 0) < TM_TTL) return;
    localStorage[key] = Date.now();
    const to = new Date(), from = new Date(to - 90 * 864e5);
    try {
      const r = await fetch(`/stats/teams/maps/${tid}/${slug || 'team'}?startDate=${ymd(from)}&endDate=${ymd(to)}`, { credentials: 'include' });
      if (!r.ok) return;
      const maps = parseMapStats(new DOMParser().parseFromString(await r.text(), 'text/html'));
      if (!maps.length) return;
      await put('tm:' + tid, { id: tid, maps, from: ymd(from), to: ymd(to), updated: new Date().toISOString() });
      console.log('COREX TV: map stats sent for team', tid);
    } catch (e) {}
  };
  const tmPage = location.pathname.match(/^\/stats\/teams\/maps\/(\d+)/);
  if (tmPage) {
    const maps = parseMapStats(document);
    if (maps.length) {
      const q = new URLSearchParams(location.search);
      localStorage['corexTm:' + tmPage[1]] = Date.now();
      put('tm:' + tmPage[1], { id: +tmPage[1], maps, from: q.get('startDate') || '', to: q.get('endDate') || '', updated: new Date().toISOString() });
      console.log('COREX TV: map stats sent from this page');
    }
    return;
  }
  const teamPage = location.pathname.match(/^\/team\/(\d+)\/([^/?#]+)/);
  if (teamPage) { setTimeout(() => pushTeamMaps(+teamPage[1], teamPage[2]), 3000); return; }

  if (/^\/events\/\d+/.test(location.pathname)) {
    const eid = +location.pathname.split('/')[2];
    let lastE = '';
    const brk = parseBrackets(document); if (brk.length) put('e:' + eid, { id: eid, brk, updated: new Date().toISOString() });
    const pushE = () => { if (parseBrackets(document).length) return; const v = captureEvent(document, eid); const sig = JSON.stringify(v.blocks) + JSON.stringify(v.jsons); if (sig !== lastE && (v.blocks.length || v.jsons.length)) { lastE = sig; put('e:' + eid, v); } };
    setTimeout(pushE, 3000); setInterval(pushE, 60000);
    console.log('COREX TV: capturing this event bracket');
    return;
  }
  clearInterval(window.__fbTimer); if (window.__fbObs) window.__fbObs.disconnect(); let last = '';
  if (/^\/matches\/\d+/.test(location.pathname)) {
    // both teams' map stats, once per 12 h each, only from the visible top-level tab (not the hidden list iframes)
    if (window.top === window) [...document.querySelectorAll('.team1-gradient a[href^="/team/"], .team2-gradient a[href^="/team/"]')]
      .map(a => a.getAttribute('href').match(/^\/team\/(\d+)\/([^/?#]+)/)).filter(Boolean).slice(0, 2)
      .forEach((m, i) => setTimeout(() => pushTeamMaps(+m[1], m[2]), 8000 + i * 6000));
    // Push the moment HLTV's scorebot changes the page. Mutation callbacks are not throttled in background
    // tabs the way timers are, so this stays live even when the tab is hidden.
    let lastAt = 0, pending = false, busy = false;
    const push = async () => {
      if (busy) { pending = true; return; }
      const s = snap(); if (!s) return;
      const { updated, ...rest } = s; const sig = JSON.stringify(rest);
      if (sig === last) return;
      last = sig; lastAt = Date.now(); busy = true;
      try { await put('m:' + s.id, s); } catch (e) {} finally { busy = false; }
      if (pending) { pending = false; push(); }
    };
    let mapName = '';
    // microtasks are never throttled in hidden tabs, so every scorebot change goes out right away;
    // the busy/pending pair coalesces bursts into back-to-back requests
    let queued = false;
    const onChange = () => {
      const now = (T(document.querySelector('.scoreboard .currentRoundText')).split(' - ')[1]) || '';
      if (now && now !== mapName) { mapName = now; refreshMaps().then(() => { last = ''; push(); }); }
      if (!queued) { queued = true; queueMicrotask(() => { queued = false; push(); }); }
    };
    clearInterval(window.__fbMapTimer);
    window.__fbMapTimer = setInterval(() => refreshMaps().then(() => { last = ''; push(); }), 45000);
    refreshMaps().then(() => { last = ''; push(); });
    const target = document.getElementById('scoreboardElement')?.parentElement || document.body;
    window.__fbObs = new MutationObserver(onChange);
    window.__fbObs.observe(target, { subtree: true, childList: true, characterData: true, attributes: true });
    window.__fbTimer = setInterval(() => { if (pending) { pending = false; push(); } }, 1000);
    push();
    console.log('COREX TV: pushing this match on every scoreboard change');
  } else {
    let liveIds = [];
    const lastSeen = {};
    // one request per finished match: read the final map scores from its page
    const saveResult = async id => {
      const m = lastSeen[id]; if (!m) return;
      try {
        const r = await fetch('/matches/' + m.path, { cache: 'no-store' }); if (!r.ok) return;
        const maps = readMaps(new DOMParser().parseFromString(await r.text(), 'text/html')).filter(x => x.n && x.n !== 'TBA');
        const won = n => maps.filter(x => x.w === n).length;
        let s1 = won(1), s2 = won(2);
        if (!s1 && !s2 && maps.length === 1) { s1 = +maps[0].s1 || 0; s2 = +maps[0].s2 || 0; }
        await put('r:' + id, { id, path: m.path, ev: m.ev, evName: m.evName, t1: m.t1, t2: m.t2, bo: m.bo, lan: m.lan, stars: m.stars,
          s1, s2, maps: maps.map(x => ({ n: x.n, s1: x.s1, s2: x.s2, w: x.w })), ended: new Date().toISOString() });
      } catch (e) {}
      delete lastSeen[id];
    };
    const onList = /^\/matches\/?$/.test(location.pathname);
    let listBusy = false, listAgain = false;
    const list = async (fromPage) => {
      if (listBusy) { listAgain = true; return; }
      listBusy = true;
      try { await listOnce(fromPage); } finally { listBusy = false; }
      if (listAgain) { listAgain = false; list(true); }
    };
    const listOnce = async (fromPage) => {
      let d;
      if (fromPage && onList && document.querySelector('.match-wrapper')) d = document;   // HLTV's own live page: no request at all
      else try {
        const r = await fetch('/matches', { cache: 'no-store' });
        if (!r.ok) return;                                   // blocked or rate-limited: keep the last good list
        d = new DOMParser().parseFromString(await r.text(), 'text/html');
      } catch (e) { return; }
      if (!d.querySelector('.match-wrapper')) return;        // a challenge page, not the match list
      const live = [], up = [], now = Date.now();
      for (const w of d.querySelectorAll('.match-wrapper')) {
        const id = +w.dataset.matchId; if (live.concat(up).some(x => x.id === id)) continue;
        const a = w.querySelector('a[href^="/matches/"]'); const names = [...w.querySelectorAll('.match-teamname')].map(T);
        const flag = sel => ((w.querySelector(sel)?.getAttribute('src') || '').match(/flags\/\d+x\d+\/(\w+)\./) || [])[1] || '';
        const m = { id, path: a ? a.getAttribute('href').replace('/matches/', '') : '', ev: +w.dataset.eventId || 0,
          evName: T(w.querySelector('.match-event .text-ellipsis')),
          t1: [+w.getAttribute('team1') || 0, names[0] || 'TBD'], t2: [+w.getAttribute('team2') || 0, names[1] || 'TBD'],
          bo: T([...w.querySelectorAll('.match-meta')].find(x => /bo\d/i.test(T(x))) || null),
          lan: w.getAttribute('lan') === 'true', stars: +w.dataset.stars || 0 };
        if (w.getAttribute('live') === 'true') {
          m.cur = [...w.querySelectorAll('.current-map-score')].map(T);
          m.mw = [...w.querySelectorAll('[data-livescore-maps-won-for]')].map(T);
          const k = (+m.mw[0] || 0) + (+m.mw[1] || 0);
          m.maps = (w.querySelector('[data-maps]')?.dataset.maps || '').split(',').filter(Boolean)
            .map((n, i) => ({ n, s1: '-', s2: '-', w: 0, pick: 0, played: i <= k, live: i === k ? 1 : 0 }));
          live.push(m);
        } else {
          const u = +(w.querySelector('[data-unix]')?.dataset.unix || 0);
          if (!u || u < now - 3 * 3600e3 || up.length >= 40) continue;
          m.time = Math.round(u / 6e4); up.push(m);
        }
      }
      const sig = JSON.stringify({ live, up });
      if (sig !== last) { last = sig; await put('now', { live, up, updated: new Date().toISOString() }); }
      const ids = live.map(m => m.id);
      // finished matches: keep a small result row 'r:<id>' (14 days, cleaned up in the database), drop the heavy scoreboard
      for (const old of liveIds) if (!ids.includes(old)) { await saveResult(old); await del('m:' + old); }
      liveIds = ids; live.forEach(m => { lastSeen[m.id] = m; });
      if (window.top === window) {
        window.__fbBrkAt = window.__fbBrkAt || {};
        for (const ev of [...new Set(live.map(m => m.ev).filter(Boolean))]) {
          if (Date.now() - (window.__fbBrkAt[ev] || 0) < 10 * 60e3) continue;
          window.__fbBrkAt[ev] = Date.now(); await pushBrackets(ev);
        }
      }
      // in a userscript on hltv.org/matches: keep a hidden same-origin frame per live match so its scoreboard streams too
      if (window.__fbFrames) {
        const want = new Set(live.map(m => String(m.id)));
        document.querySelectorAll('iframe[data-fb-match]').forEach(f => { if (!want.has(f.dataset.fbMatch)) f.remove(); });
        for (const m of live) {
          if (document.querySelector(`iframe[data-fb-match="${m.id}"]`)) continue;
          const f = document.createElement('iframe');
          f.dataset.fbMatch = String(m.id); f.src = '/matches/' + m.path;
          f.style.cssText = 'position:fixed;left:0;bottom:0;width:640px;height:480px;opacity:0;pointer-events:none;border:0;z-index:-1';
          // when the collector was pasted/injected (no userscript), run the same code inside each match frame too
          f.addEventListener('load', () => { try { if (window.__fbSrc && !f.contentWindow.__fbObs) f.contentWindow.eval(window.__fbSrc); } catch (e) {} });
          document.body.appendChild(f);
        }
      }
    };
    list(true);
    // HLTV pushes live changes into /matches itself: react to them at once (a match going live shows up within ~1 s)
    if (onList) {
      let t = 0;
      const obs = new MutationObserver(() => { clearTimeout(t); t = setTimeout(() => list(true), 700); });
      obs.observe(document.querySelector('.matches-list-column, .mainContent, main') || document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['live', 'data-livescore-maps-won-for'] });
      // a fresh copy of the page now and then, so matches HLTV adds later are picked up too
      window.__fbTimer = setInterval(() => list(false), 15000);
      setTimeout(() => location.reload(), 30 * 60e3);
    } else window.__fbTimer = setInterval(list, 15000);
    console.log('COREX TV: pushing the live match list');
  }
})();
