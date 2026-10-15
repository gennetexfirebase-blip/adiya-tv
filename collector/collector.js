// ADIYA TV collector: run on an open hltv.org page (DevTools console or a userscript).
// On a /matches/<id>/... page it pushes that match's scoreboard, log and radar every 2.5 s (only when something changed).
// On any other hltv.org page it pushes the live-match list every 10 s.
// Settings live in localStorage, never in this file:
//   localStorage.FB_CFG = JSON.stringify({url:"https://<ref>.supabase.co", anonKey:"<anon key>", writerKey:"<writer key>"})
(() => {
  const cfg = JSON.parse(localStorage.FB_CFG || '{}');
  if (!cfg.url || !cfg.anonKey || !cfg.writerKey) return console.warn('ADIYA TV: FB_CFG missing');
  const T = x => x ? x.textContent.replace(/\s+/g, ' ').trim() : '';
  const H = { apikey: cfg.anonKey, Authorization: 'Bearer ' + cfg.anonKey, 'x-fb-key': cfg.writerKey };
  const put = (k, v) => fetch(cfg.url + '/rest/v1/live?on_conflict=k', {
    method: 'POST',
    headers: { ...H, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ k, v, at: new Date().toISOString() })
  });
  const del = k => fetch(cfg.url + '/rest/v1/live?k=eq.' + encodeURIComponent(k), { method: 'DELETE', headers: H });

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
    return { id: +se.dataset.scorebotId, t1: se.dataset.team1Name, t2: se.dataset.team2Name,
      round: T(top?.querySelector('.currentRoundText')), ct: T(top?.querySelector('.ctScore')), t: T(top?.querySelector('.tScore')),
      clock: T(top?.querySelector('.timeText')), teams, log, prob, streams, radar, updated: new Date().toISOString() };
  }

  clearInterval(window.__fbTimer); let last = '';
  if (/^\/matches\/\d+/.test(location.pathname)) {
    window.__fbTimer = setInterval(() => {
      const s = snap(); if (!s) return;
      const { updated, ...rest } = s; const sig = JSON.stringify(rest);
      if (sig !== last) { last = sig; put('m:' + s.id, s); }
    }, 2500);
    console.log('ADIYA TV: pushing this match');
  } else {
    let liveIds = [];
    const list = async () => {
      const d = new DOMParser().parseFromString(await fetch('/matches', { cache: 'no-store' }).then(r => r.text()), 'text/html');
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
      for (const old of liveIds) if (!ids.includes(old)) await del('m:' + old); // finished matches leave the table
      liveIds = ids;
    };
    list(); window.__fbTimer = setInterval(list, 10000);
    console.log('ADIYA TV: pushing the live match list');
  }
})();
