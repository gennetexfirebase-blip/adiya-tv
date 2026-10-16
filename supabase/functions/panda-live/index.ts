// COREX TV server-side live feed from PandaScore (free plan): runs every minute via pg_cron and polls for ~55 s.
// Writes 'pnow' (running + upcoming CS2 matches) and 'r:p<id>' (finished matches) into public.live, through the same
// RLS check the browser collector uses (x-fb-key). Budget: 12 running polls + 1 upcoming + 1 past per minute = 840 req/h (< 1000).
const TOKEN = Deno.env.get("panda") ?? "";
const SB = Deno.env.get("SUPABASE_URL")!, ANON = Deno.env.get("SUPABASE_ANON_KEY")!, WRITER = Deno.env.get("FB_WRITER") ?? "";
const OFFSET = 900000000; // keeps PandaScore ids apart from HLTV match ids on the site

const api = async (p: string) => {
  const r = await fetch("https://api.pandascore.co" + p, { headers: { Authorization: "Bearer " + TOKEN, Accept: "application/json" } });
  if (!r.ok) throw new Error("pandascore " + r.status);
  return await r.json();
};
const put = (k: string, v: unknown) => fetch(SB + "/rest/v1/live?on_conflict=k", {
  method: "POST",
  headers: { apikey: ANON, Authorization: "Bearer " + ANON, "x-fb-key": WRITER, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
  body: JSON.stringify({ k, v, at: new Date().toISOString() }),
});
const prov = (u: string) => /twitch/.test(u) ? "twitch" : /kick\.com/.test(u) ? "kick" : /youtu/.test(u) ? "youtube" : "";
const LANG: Record<string, string> = { mn: "Mongolia", en: "United Kingdom", ru: "Russia", pt: "Brazil", es: "Spain", fr: "France", de: "Germany", pl: "Poland", tr: "Turkey", zh: "China", ja: "Japan", ko: "South Korea", uk: "Ukraine", kk: "Kazakhstan" };

// deno-lint-ignore no-explicit-any
const shape = (m: any) => {
  const op = (m.opponents || []).map((o: any) => o.opponent).filter(Boolean);
  const a = op[0] || { id: 0, name: "TBD" }, b = op[1] || { id: 0, name: "TBD" };
  const sc = (id: number) => (m.results || []).find((r: any) => r.team_id === id)?.score ?? 0;
  const games = (m.games || []).slice().sort((x: any, y: any) => x.position - y.position);
  const ev = [m.league?.name, m.serie?.full_name, m.tournament?.name].filter(Boolean).join(" · ");
  return {
    id: OFFSET + m.id, src: "panda", ev: 0, evName: ev, path: "",
    t1: [0, a.name, a.image_url || ""], t2: [0, b.name, b.image_url || ""],
    bo: "bo" + (m.number_of_games || 1), lan: false, stars: ({ s: 2, a: 1 } as Record<string, number>)[m.tournament?.tier] || 0,
    mw: [String(sc(a.id)), String(sc(b.id))], cur: [],
    maps: games.map((g: any) => ({ n: "Мап " + g.position, s1: "-", s2: "-", w: g.winner?.id ? (g.winner.id === a.id ? 1 : 2) : 0, pick: 0,
      played: g.status !== "not_started", live: g.status === "running" ? 1 : 0 })),
    streams: (m.streams_list || []).filter((s: any) => s.raw_url).map((s: any) => ({ name: (s.raw_url.split("/").filter(Boolean).pop() || ""), flag: LANG[s.language] || "", viewers: 0, prov: prov(s.raw_url), url: s.raw_url })),
    time: Math.round(Date.parse(m.begin_at || m.scheduled_at || new Date().toISOString()) / 6e4),
    begin: m.begin_at, winner: m.winner_id ? (m.winner_id === a.id ? 1 : 2) : 0,
  };
};

Deno.serve(async () => {
  if (!TOKEN || !WRITER) return new Response("missing secrets", { status: 500 });
  const started = Date.now();
  let up: unknown[] = [], last = "", writes = 0;
  try {
    const u = await api("/csgo/matches/upcoming?per_page=40&sort=begin_at");
    up = u.filter((m: any) => Date.parse(m.begin_at || m.scheduled_at) < Date.now() + 36 * 3600e3).map(shape);
  } catch (_) { /* keep going with live only */ }
  try {
    const past = await api("/csgo/matches/past?per_page=40&sort=-modified_at");
    for (const m of past) {
      const at = m.end_at || m.begin_at || m.scheduled_at;
      if (!at || Date.parse(at) < Date.now() - 14 * 864e5 || m.status !== "finished" || !(m.opponents || []).length) continue;
      const s = shape(m);
      await put("r:p" + m.id, { id: s.id, src: "panda", ev: 0, evName: s.evName, t1: s.t1, t2: s.t2, bo: s.bo, lan: false,
        s1: +s.mw[0], s2: +s.mw[1], maps: [], ended: at });
    }
  } catch (_) { /* results are best effort */ }
  while (Date.now() - started < 54000) {
    try {
      const run = (await api("/csgo/matches/running?per_page=50")).map(shape);
      const v = { live: run, up, updated: new Date().toISOString(), src: "panda" };
      const sig = JSON.stringify({ run, up });
      if (sig !== last || writes === 0) { last = sig; await put("pnow", v); writes++; }
      else if (writes % 6 === 0) { await put("pnow", v); writes++; } // heartbeat ~ every 30 s so the site knows the feed is alive
      else writes++;
    } catch (_) { /* rate limit or network: try again next tick */ }
    await new Promise((r) => setTimeout(r, 5000));
  }
  return new Response("ok");
});
