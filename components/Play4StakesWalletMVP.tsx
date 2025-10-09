import React, { useEffect, useMemo, useState } from "react";

/*******************************
 * PLAY4STAKES — LANDING + WALLET MVP (COMBINED)
 * - Landing page (Preview Now or Log in / Sign up)
 * - Auth stub (placeholder; stores session flag)
 * - Wallet MVP app (balances, stake, escrow, accept, payout)
 * - Join by code, Share/Copy (clipboard-safe), Deep links
 * - Live 6-decimal timer for all games
 *******************************/

type GameType = 'SCOUT' | 'DOWN' | 'UP';

type Result = { rawMs: number; finalMs: number; finishedAt: number };

type Challenge = {
  code: string;
  gameType: GameType;
  seed: string; // base36 seed
  stake: number;
  status: 'OPEN' | 'FILLED' | 'COMPLETE' | 'EXPIRED';
  creatorUid?: string;
  opponentUid?: string;
  creatorAccepted?: boolean;
  opponentAccepted?: boolean;
  escrowedCreator?: number; // coins held from creator
  escrowedOpponent?: number; // coins held from opponent
  creatorResult?: Result;
  opponentResult?: Result;
  createdAt: number;
  expiresAt: number;
  settled?: boolean;
};

type View =
  | { name: 'landing' }
  | { name: 'auth'; redirect?: string }
  | { name: 'app' }
  | { name: 'game'; which: GameType }
  | { name: 'play'; code: string; role: 'creator' | 'opponent' };

/*******************************
 * STORAGE (localStorage)
 *******************************/
const LS_CHALLENGES = 'p4s_challenges_v2';
const LS_WALLETS = 'p4s_wallets_v1';
const LS_UID = 'p4s_uid_v1';
const LS_AUTH = 'p4s_auth_v1';

function getUID() {
  try {
    const existing = localStorage.getItem(LS_UID);
    if (existing) return existing;
    const fresh = 'U_' + Math.random().toString(36).slice(2, 10).toUpperCase();
    localStorage.setItem(LS_UID, fresh);
    // seed wallet with starter coins
    const wallets = loadWallets();
    wallets[fresh] = 1000; // starter balance
    saveWallets(wallets);
    return fresh;
  } catch {
    return 'U_GUEST';
  }
}
function loadAuth(): { authed: boolean; uid: string } {
  try {
    const json = localStorage.getItem(LS_AUTH);
    if (json) return JSON.parse(json);
  } catch {}
  return { authed: false, uid: getUID() };
}
function saveAuth(a: { authed: boolean; uid: string }) {
  localStorage.setItem(LS_AUTH, JSON.stringify(a));
}
function loadWallets(): Record<string, number> {
  try { const s = localStorage.getItem(LS_WALLETS); return s ? JSON.parse(s) : {}; } catch { return {}; }
}
function saveWallets(map: Record<string, number>) { localStorage.setItem(LS_WALLETS, JSON.stringify(map)); }

/** ---- Wallet helpers (renamed to avoid React state setter collision) ---- */
function getWalletBalance(uid: string) { const w = loadWallets(); return w[uid] ?? 0; }
function setWalletBalance(uid: string, amt: number) { const w = loadWallets(); w[uid] = amt; saveWallets(w); }

/** Optional convenience helpers */
function credit(uid: string, amount: number) {
  const next = getWalletBalance(uid) + amount;
  setWalletBalance(uid, next);
  return next;
}
function debit(uid: string, amount: number) {
  const cur = getWalletBalance(uid);
  if (cur < amount) throw new Error('INSUFFICIENT_FUNDS');
  const next = cur - amount;
  setWalletBalance(uid, next);
  return next;
}

function loadChallenges(): Record<string, Challenge> {
  try { const s = localStorage.getItem(LS_CHALLENGES); return s ? JSON.parse(s) : {}; } catch { return {}; }
}
function saveChallenges(map: Record<string, Challenge>) { localStorage.setItem(LS_CHALLENGES, JSON.stringify(map)); }
function upsertChallenge(ch: Challenge) { const map = loadChallenges(); map[ch.code] = ch; saveChallenges(map); }
function getChallenge(code: string): Challenge | undefined { const map = loadChallenges(); return map[code.toUpperCase()]; }

/*******************************
 * UTILS: Codes, PRNG, Seeds, Shuffle
 *******************************/
function genCode(len = 4) { const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let out = ''; for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)]; return out; }
function hashStr(str: string) { let h = 2166136261 >>> 0; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function mulberry32(a: number) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function prngFromSeed(seed: string) { return mulberry32(hashStr(seed)); }
function seededShuffle<T>(arr: T[], rnd: () => number) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function seededPickUnique(range: number[], count: number, rnd: () => number) { const pool = range.slice(); const out: number[] = []; while (out.length < count && pool.length) { const idx = Math.floor(rnd() * pool.length); out.push(pool[idx]); pool.splice(idx, 1); } return out; }

/*******************************
 * CLIPBOARD-SAFE COPY + SHARE
 *******************************/
function CopyableCode({ label, value, filename }: { label: string; value: string; filename?: string }) {
  const [state, setState] = useState<'idle' | 'ok' | 'manual'>('idle');
  const inputId = `copy-${label.replace(/\W+/g, '-')}-${value}`;
  async function tryCopy() {
    try { if ((navigator as any).clipboard?.writeText) { await (navigator as any).clipboard.writeText(value); setState('ok'); return; } throw new Error('Clipboard API unavailable'); } catch {
      try { const ta = document.createElement('textarea'); ta.value = value; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); document.body.removeChild(ta); if (ok) { setState('ok'); return; } throw new Error('execCommand failed'); } catch {
        setState('manual'); const el = document.getElementById(inputId) as HTMLInputElement | null; if (el) { el.focus(); el.select(); }
      }
    }
  }
  function downloadTxt() { const blob = new Blob([value], { type: 'text/plain' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = (filename || label).replace(/\s+/g, '_') + '.txt'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); }
  return (
    <div className="w-full">
      <div className="text-xs text-zinc-400 mb-1">{label}</div>
      <div className="flex items-center gap-2">
        <input id={inputId} readOnly value={value} className="flex-1 px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 font-mono text-sm" />
        <button onClick={tryCopy} className="px-3 py-2 rounded-lg bg-white text-black text-sm font-semibold">Copy</button>
        <button onClick={downloadTxt} className="px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm">Download .txt</button>
      </div>
      {state === 'ok' && <div className="text-xs text-green-400 mt-2">Copied!</div>}
      {state === 'manual' && <div className="text-xs text-zinc-400 mt-2">Clipboard blocked here. Text is selected — press <span className="font-mono">Ctrl/⌘+C</span>.</div>}
    </div>
  );
}

function ShareButton({ url, code }: { url: string; code: string }) {
  const [msg, setMsg] = useState<string | null>(null);
  async function onShare() {
    const text = `Play4Stakes challenge code: ${code}\n${url}`;
    try { if ((navigator as any).share) { await (navigator as any).share({ title: 'Play4Stakes Challenge', text, url }); setMsg('Shared'); return; } } catch {}
    try { if ((navigator as any).clipboard?.writeText) { await (navigator as any).clipboard.writeText(text); setMsg('Link copied'); return; } } catch {}
    window.prompt('Copy this challenge link:', text); setMsg('Copy manually');
  }
  return (
    <div className="flex items-center gap-2">
      <button onClick={onShare} className="px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm">Share Challenge</button>
      {msg && <span className="text-xs text-zinc-400">{msg}</span>}
    </div>
  );
}

/*******************************
 * SHELL + HEADER (with balance strip when authed)
 *******************************/
function Shell({ children, onBack, showBack, authed, uid }: { children: React.ReactNode; onBack?: () => void; showBack?: boolean; authed: boolean; uid: string }) {
  const [balance, setBalance] = useState<number>(getWalletBalance(uid));
  useEffect(() => { setBalance(getWalletBalance(uid)); }, [uid]);
  const onTopUp = () => { const next = credit(uid, 500); setBalance(next); };
  return (
    <div className="min-h-screen bg-black text-white">
      <header className="px-4 py-6 border-b border-zinc-900">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="text-2xl md:text-3xl font-extrabold tracking-tight">Play4Stakes</div>
          {authed ? (
            <div className="flex items-center gap-3 text-sm">
              <div className="px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800">Balance: <span className="font-semibold">{balance}</span> coins</div>
              <button onClick={onTopUp} className="px-3 py-1.5 rounded-lg bg-white text-black font-semibold">Top Up +500</button>
            </div>
          ) : (
            <div className="text-sm text-zinc-400">Preview Mode</div>
          )}
        </div>
      </header>
      <main className="px-4 py-8">
        <div className="max-w-6xl mx-auto">{children}</div>
      </main>
      {showBack && (
        <div className="fixed left-4 bottom-4">
          <button onClick={onBack} className="px-3 py-2 rounded-lg border border-zinc-800 text-sm text-zinc-300 bg-zinc-950">← Back</button>
        </div>
      )}
    </div>
  );
}

/*******************************
 * GAMES — PREVIEW (unseeded)
 *******************************/
function GameGridShuffled() { const nums = Array.from({ length: 25 }, (_, i) => i + 1); for (let i = nums.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [nums[i], nums[j]] = [nums[j], nums[i]]; } return nums; }
function gameGridFromSeed(seed: string) { const rnd = prngFromSeed('grid-' + seed); const nums = Array.from({ length: 25 }, (_, i) => i + 1); return seededShuffle(nums, rnd); }

function FiveNumberScoutPreview() {
  const grid = useMemo(() => GameGridShuffled(), []);
  const targets = useMemo(() => { const rnd = prngFromSeed('targets-' + Math.random().toString(36).slice(2)); return seededPickUnique(Array.from({ length: 25 }, (_, i) => i + 1), 5, rnd); }, []);
  const [started, setStarted] = useState(false); const [startTime, setStart] = useState<number | null>(null); const [now, setNow] = useState<number | null>(null); const [elapsed, setElapsed] = useState<string | null>(null); const [found, setFound] = useState<number[]>([]);
  useEffect(() => { let raf: number; if (started && !elapsed) { const tick = () => { setNow(performance.now()); raf = requestAnimationFrame(tick); }; raf = requestAnimationFrame(tick);} return () => { if (raf) cancelAnimationFrame(raf);} }, [started, elapsed]);
  const start = () => { if (started) return; const t = performance.now(); setStarted(true); setStart(t); setNow(t); };
  const click = (n: number) => { if (!started || elapsed) return; if (targets.includes(n) && !found.includes(n)) { const nxt = [...found, n]; setFound(nxt); if (nxt.length === 5 && startTime) { const secs = (performance.now() - startTime) / 1000; setElapsed(secs.toFixed(6)); } } };
  const live = (() => { if (!started || !startTime) return '0.000000'; if (elapsed) return Number(elapsed).toFixed(6); const s = ((now ?? startTime) - startTime) / 1000; return s.toFixed(6); })();
  return (
    <div>
      <h3 className="text-xl font-bold mb-2">5 Numbers Scout</h3>
      <div className="flex items-center gap-3 mb-3">{!started && <button onClick={start} className="px-3 py-1.5 rounded-lg bg-white text-black font-semibold">Start</button>}<div className="font-mono">Time: {live}s</div></div>
      <div className="flex items-center gap-2 mb-3">{targets.map((t,i)=>(<span key={i} className={`px-3 py-1 rounded-full text-lg font-bold border ${found.includes(t)?'bg-green-500 text-black border-green-500':'bg-zinc-900 border-zinc-800'}`}>{t}</span>))}</div>
      <div className="grid grid-cols-5 gap-2">{grid.map((num, idx)=>{ const hit = found.includes(num); const target = targets.includes(num); return (<button key={idx} onClick={()=>click(num)} className={`w-12 h-12 md:w-14 md:h-14 text-xl font-bold rounded-lg ${hit?'bg-green-500 text-black':'bg-zinc-800 hover:bg-zinc-700'} ${target&&!hit?'ring-1 ring-zinc-600':''}`} disabled={hit || !!elapsed}>{num}</button>); })}</div>
    </div>
  );
}

function TwentyFiveDownPreview() {
  const grid = useMemo(() => GameGridShuffled(), []);
  const [started, setStarted] = useState(false); const [startTime, setStart] = useState<number | null>(null); const [now, setNow] = useState<number | null>(null); const [elapsed, setElapsed] = useState<string | null>(null); const [nextNum, setNext] = useState(25); const [found, setFound] = useState<Set<number>>(()=>new Set());
  useEffect(()=>{ let raf:number; if(started&&!elapsed){ const tick=()=>{ setNow(performance.now()); raf=requestAnimationFrame(tick);}; raf=requestAnimationFrame(tick);} return()=>{ if(raf) cancelAnimationFrame(raf);} },[started,elapsed]);
  const start = ()=>{ if(started) return; const t=performance.now(); setStarted(true); setStart(t); setNow(t); };
  const click=(n:number)=>{ if(!started||elapsed) return; if(n!==nextNum) return; setFound(prev=>new Set(prev).add(n)); if(nextNum===1 && startTime){ const secs=(performance.now()-startTime)/1000; setElapsed(secs.toFixed(6)); } else { setNext(v=>v-1);} };
  const live =(()=>{ if(!started||!startTime) return '0.000000'; if(elapsed) return Number(elapsed).toFixed(6); const s=((now??startTime)-startTime)/1000; return s.toFixed(6); })();
  return (
    <div>
      <h3 className="text-xl font-bold mb-2">25 Down</h3>
      <div className="flex items-center gap-3 mb-3">{!started && <button onClick={start} className="px-3 py-1.5 rounded-lg bg-white text-black font-semibold">Start</button>}<div className="font-mono">Time: {live}s</div><div className="text-sm text-zinc-400">Next: <span className="font-semibold text-white">{elapsed?'-':nextNum}</span></div></div>
      <div className="grid grid-cols-5 gap-2">{grid.map((num, idx)=>{ const hit=found.has(num); return (<button key={idx} onClick={()=>click(num)} className={`w-12 h-12 md:w-14 md:h-14 text-xl font-bold rounded-lg ${hit?'bg-green-500 text-black':'bg-zinc-800 hover:bg-zinc-700'}`} disabled={hit||!!elapsed}>{num}</button>); })}</div>
    </div>
  );
}

function TwentyFiveUpPreview() {
  const grid = useMemo(() => GameGridShuffled(), []);
  const [started, setStarted] = useState(false); const [startTime, setStart] = useState<number | null>(null); const [now, setNow] = useState<number | null>(null); const [elapsed, setElapsed] = useState<string | null>(null); const [nextNum, setNext] = useState(1); const [found, setFound] = useState<Set<number>>(()=>new Set());
  useEffect(()=>{ let raf:number; if(started&&!elapsed){ const tick=()=>{ setNow(performance.now()); raf=requestAnimationFrame(tick);}; raf=requestAnimationFrame(tick);} return()=>{ if(raf) cancelAnimationFrame(raf);} },[started,elapsed]);
  const start = ()=>{ if(started) return; const t=performance.now(); setStarted(true); setStart(t); setNow(t); };
  const click=(n:number)=>{ if(!started||elapsed) return; if(n!==nextNum) return; setFound(prev=>new Set(prev).add(n)); if(nextNum===25 && startTime){ const secs=(performance.now()-startTime)/1000; setElapsed(secs.toFixed(6)); } else { setNext(v=>v+1);} };
  const live =(()=>{ if(!started||!startTime) return '0.000000'; if(elapsed) return Number(elapsed).toFixed(6); const s=((now??startTime)-startTime)/1000; return s.toFixed(6); })();
  return (
    <div>
      <h3 className="text-xl font-bold mb-2">25 Up</h3>
      <div className="flex items-center gap-3 mb-3">{!started && <button onClick={start} className="px-3 py-1.5 rounded-lg bg-white text-black font-semibold">Start</button>}<div className="font-mono">Time: {live}s</div><div className="text-sm text-zinc-400">Next: <span className="font-semibold text-white">{elapsed?'-':nextNum}</span></div></div>
      <div className="grid grid-cols-5 gap-2">{grid.map((num, idx)=>{ const hit=found.has(num); return (<button key={idx} onClick={()=>click(num)} className={`w-12 h-12 md:w-14 md:h-14 text-xl font-bold rounded-lg ${hit?'bg-green-500 text-black':'bg-zinc-800 hover:bg-zinc-700'}`} disabled={hit||!!elapsed}>{num}</button>); })}</div>
    </div>
  );
}

/*******************************
 * LANDING + AUTH (stub)
 *******************************/
function Landing({ onNavigate }: { onNavigate: (v: View) => void }) {
  const [code, setCode] = useState('');
  return (
    <div className="min-h-screen bg-black text-white">
      <header className="px-4 py-6 border-b border-zinc-900">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="text-2xl md:text-3xl font-extrabold tracking-tight">Play4Stakes</div>
          <button onClick={() => onNavigate({ name: 'auth', redirect: '/app' })} className="px-3 py-1.5 rounded-lg border border-zinc-800 text-sm text-zinc-300 hover:bg-zinc-900">Log in / Sign up</button>
        </div>
      </header>
      <main className="px-4 py-10">
        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-[1fr_340px] gap-8 items-start">
          <div>
            <h1 className="text-4xl font-extrabold mb-3">Stake your skill. Win the pot.</h1>
            <p className="text-zinc-300 mb-6">Preview right now with no login, or sign in for balances, stakes, and shareable challenges.</p>
            <div className="flex gap-3 mb-10">
              <button onClick={() => onNavigate({ name: 'app' })} className="px-5 py-3 rounded-lg bg-white text-black font-semibold">Preview the Games</button>
              <button onClick={() => onNavigate({ name: 'auth', redirect: '/app' })} className="px-5 py-3 rounded-lg border border-zinc-800">Log in / Sign up</button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <FeatureCard title="5 Numbers Scout" onClick={() => onNavigate({ name: 'game', which: 'SCOUT' })} />
              <FeatureCard title="25 Down" onClick={() => onNavigate({ name: 'game', which: 'DOWN' })} />
              <FeatureCard title="25 Up" onClick={() => onNavigate({ name: 'game', which: 'UP' })} />
            </div>
          </div>
          <aside className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
            <h3 className="text-lg font-bold mb-2">Join a Challenge</h3>
            <div className="flex items-center gap-2">
              <input value={code} onChange={e=>setCode(e.target.value.toUpperCase())} placeholder="Enter Code (e.g., 7K3F)" className="flex-1 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 outline-none" />
              <button onClick={()=> code && onNavigate({ name: 'play', code, role: 'opponent' })} className="px-4 py-2 rounded-lg bg-white text-black font-semibold">Join</button>
            </div>
            <p className="text-xs text-zinc-500 mt-2">Paste a code to play the same seeded board.</p>
          </aside>
        </div>
      </main>
    </div>
  );
}

function AuthStub({ onNavigate, redirect }: { onNavigate: (v: View) => void; redirect?: string }) {
  const [email, setEmail] = useState('');
  const auth = loadAuth();
  const doLogin = () => {
    const uid = auth.uid || getUID();
    saveAuth({ authed: true, uid });
    onNavigate({ name: 'app' });
  };
  const doLogout = () => { saveAuth({ authed: false, uid: getUID() }); onNavigate({ name: 'landing' }); };
  return (
    <div className="min-h-screen bg-black text-white">
      <header className="px-4 py-6 border-b border-zinc-900">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="text-2xl font-extrabold">Play4Stakes</div>
          <button onClick={() => onNavigate({ name: 'landing' })} className="px-3 py-1.5 rounded-lg border border-zinc-800 text-sm">← Back</button>
        </div>
      </header>
      <main className="px-4 py-10">
        <div className="max-w-md mx-auto rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
          <h1 className="text-2xl font-bold mb-2">Log in / Sign up</h1>
          <p className="text-sm text-zinc-400 mb-4">Auth placeholder. We’ll swap in Supabase/Clerk later.</p>
          <input value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 mb-3" />
          <button onClick={doLogin} className="w-full px-4 py-2 rounded-lg bg-white text-black font-semibold">Continue</button>
          <button onClick={doLogout} className="w-full mt-2 px-4 py-2 rounded-lg border border-zinc-800">Sign out</button>
          {redirect && <p className="text-xs text-zinc-500 mt-3">After login you’ll continue to: <span className="font-mono">{redirect}</span></p>}
        </div>
      </main>
    </div>
  );
}

/*******************************
 * WALLET MVP — APP SHELL & FLOW
 *******************************/
function AppLanding({ onNavigate, authed, uid }: { onNavigate: (v: View) => void; authed: boolean; uid: string }) {
  const [code, setCode] = useState('');
  return (
    <Shell authed={authed} uid={uid}>
      <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-6">Play4Stakes Arcade</h1>
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5 max-w-2xl mb-8">
        <h3 className="text-lg font-bold mb-2">Join a Challenge</h3>
        <div className="flex items-center gap-2">
          <input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="Enter Code (e.g., 7K3F)" className="flex-1 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 outline-none" />
          <button onClick={() => code && onNavigate({ name: 'play', code, role: 'opponent' })} className="px-4 py-2 rounded-lg bg-white text-black font-semibold">Join</button>
        </div>
        <p className="text-xs text-zinc-500 mt-2">Use a code shared by a friend to load the same seeded board.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <GameCard title="5 Numbers Scout" desc="Find any five targets fast." onClick={() => onNavigate({ name: 'game', which: 'SCOUT' })} />
        <GameCard title="25 Down" desc="Tap 25 → 1 in order." onClick={() => onNavigate({ name: 'game', which: 'DOWN' })} />
        <GameCard title="25 Up" desc="Tap 1 → 25 in order." onClick={() => onNavigate({ name: 'game', which: 'UP' })} />
      </div>
    </Shell>
  );
}

function GamePage({ title, game, onNavigate, authed, uid }: { title: string; game: GameType; onNavigate: (v: View) => void; authed: boolean; uid: string }) {
  const [stake, setStake] = useState<number>(50);
  const [createInfo, setCreateInfo] = useState<{ code: string; seed: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const shareUrl = (code: string, role: 'creator' | 'opponent' = 'opponent') => {
    try { const u = new URL(window.location.href); u.searchParams.set('code', code); u.searchParams.set('role', role); return u.toString(); } catch { return `?code=${code}&role=${role}`; }
  };

  const handleCreate = () => {
    setErr(null);
    if (!authed) { return onNavigate({ name: 'auth', redirect: '/app' }); }
    const balance = getWalletBalance(uid);
    if (stake <= 0 || !Number.isFinite(stake)) return setErr('Enter a valid stake');
    if (balance < stake) return setErr('Insufficient balance — top up then retry.');

    const code = genCode();
    const seed = (Math.random().toString(36).slice(2) + Date.now().toString(36)).toUpperCase();
    const ch: Challenge = {
      code, gameType: game, seed, stake,
      status: 'OPEN', createdAt: Date.now(), expiresAt: Date.now() + 48 * 3600 * 1000,
      creatorUid: uid, creatorAccepted: true, escrowedCreator: stake,
    };
    // escrow creator stake
    setWalletBalance(uid, balance - stake);
    upsertChallenge(ch);
    setCreateInfo({ code, seed });
  };

  return (
    <Shell showBack onBack={() => onNavigate({ name: 'app' })} authed={authed} uid={uid}>
      <div className="grid grid-cols-1 md:grid-cols-[1fr_320px] gap-6 items-start">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
          {game === 'SCOUT' && <FiveNumberScoutPreview />}
          {game === 'DOWN' && <TwentyFiveDownPreview />}
          {game === 'UP' && <TwentyFiveUpPreview />}
        </div>
        <aside className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
          <h3 className="text-lg font-bold mb-2">Play Modes</h3>
          <div className="space-y-3">
            <div className="block w-full text-center px-4 py-2 rounded-lg bg-white text-black font-semibold">Preview (on-page)</div>
            <div className="rounded-lg border border-zinc-800 p-3">
              <div className="text-sm text-zinc-400 mb-2">Create Actual Challenge</div>
              <label className="text-xs text-zinc-400">Stake (coins)</label>
              <input type="number" value={stake} onChange={e=>setStake(parseInt(e.target.value||'0',10))} className="w-full mt-1 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800" />
              <button onClick={handleCreate} className="mt-3 w-full px-4 py-2 rounded-lg bg-zinc-800 text-white font-semibold border border-zinc-700">Create</button>
              {err && <div className="mt-2 text-xs text-red-400">{err}</div>}
            </div>
          </div>
          {createInfo && (
            <div className="mt-4 p-3 rounded-lg bg-zinc-900 border border-zinc-800">
              <div className="text-sm text-zinc-400">Challenge Created</div>
              <div className="text-xl font-mono font-bold mt-1">Code: {createInfo.code}</div>
              <div className="text-xs text-zinc-500 mt-1 break-all">Seed: {createInfo.seed}</div>
              <div className="text-xs text-zinc-400 mt-1">Stake: <span className="font-semibold text-white">{stake}</span> coins (escrowed)</div>
              <div className="flex flex-col gap-2 mt-3">
                <button onClick={() => onNavigate({ name: 'play', code: createInfo.code, role: 'creator' })} className="px-3 py-2 rounded-lg bg-white text-black text-sm font-semibold">Play as Creator</button>
                <CopyableCode label="Share this code" value={createInfo.code} filename={`challenge_${createInfo.code}`} />
                <ShareButton url={shareUrl(createInfo.code, 'opponent')} code={createInfo.code} />
              </div>
            </div>
          )}
          <p className="text-xs text-zinc-400 mt-4">Stake is deducted now and held in escrow. Opponent must accept the same stake to play.</p>
        </aside>
      </div>
    </Shell>
  );
}

function GameCard({ title, desc, onClick }: { title: string; desc: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="text-left block w-full rounded-2xl border border-zinc-800 bg-zinc-950 p-5 hover:bg-zinc-900 transition-colors">
      <div className="text-xl font-bold mb-1">{title}</div>
      <div className="text-sm text-zinc-400 mb-4">{desc}</div>
      <div className="text-sm text-black font-semibold inline-block bg-white px-3 py-1 rounded-lg">Open</div>
    </button>
  );
}
function FeatureCard({ title, onClick }: { title: string; onClick: () => void }) { return <GameCard title={title} desc="Interactive preview" onClick={onClick} />; }

/*******************************
 * CHALLENGE PLAY (seeded, escrow, accept, payout)
 *******************************/
function PlayChallenge({ code, role, onNavigate, authed, uid }: { code: string; role: 'creator' | 'opponent'; onNavigate: (v: View) => void; authed: boolean; uid: string }) {
  const [ch, setCh] = useState<Challenge | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const found = getChallenge(code);
    if (found) {
      if (role === 'opponent' && !found.opponentUid) found.opponentUid = uid;
      if (role === 'creator' && !found.creatorUid) found.creatorUid = uid;
      upsertChallenge(found);
    }
    setCh(found ?? null);
  }, [code, role, uid]);

  if (!ch) {
    return (
      <Shell showBack onBack={() => onNavigate({ name: 'app' })} authed={authed} uid={uid}>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5 max-w-xl">
          <h2 className="text-xl font-bold mb-2">Challenge Not Found</h2>
          <p className="text-sm text-zinc-400">Check the code and try again.</p>
        </div>
      </Shell>
    );
  }

  const acceptOpponent = () => {
    setErr(null);
    if (!authed) return onNavigate({ name: 'auth', redirect: `/play?code=${code}&role=opponent` });
    const bal = getWalletBalance(uid);
    if (bal < ch.stake) { setErr('Insufficient balance — top up then accept.'); return; }
    ch.opponentUid = uid; ch.opponentAccepted = true; ch.status = 'FILLED'; ch.escrowedOpponent = (ch.escrowedOpponent ?? 0) + ch.stake;
    setWalletBalance(uid, bal - ch.stake);
    upsertChallenge(ch);
    setCh({ ...ch });
  };

  const submit = (res: Result, r: 'creator' | 'opponent') => {
    const current = getChallenge(ch.code)!;
    if (r === 'creator' && !current.creatorResult) current.creatorResult = res;
    if (r === 'opponent' && !current.opponentResult) current.opponentResult = res;
    current.status = current.creatorResult && current.opponentResult ? 'COMPLETE' : current.status;
    upsertChallenge(current); setCh({ ...current });
    if (current.status === 'COMPLETE' && !current.settled) settle(current);
  };

  function settle(c: Challenge) {
    const pot = (c.escrowedCreator ?? 0) + (c.escrowedOpponent ?? 0);
    const a = c.creatorResult?.finalMs ?? Infinity;
    const b = c.opponentResult?.finalMs ?? Infinity;
    if (!isFinite(a) || !isFinite(b)) return; // wait until both done
    if (a < b) {
      // creator wins
      if (c.creatorUid) setWalletBalance(c.creatorUid, getWalletBalance(c.creatorUid) + pot);
    } else if (b < a) {
      if (c.opponentUid) setWalletBalance(c.opponentUid, getWalletBalance(c.opponentUid) + pot);
    } else {
      // tie — refund
      if (c.creatorUid) setWalletBalance(c.creatorUid, getWalletBalance(c.creatorUid) + (c.escrowedCreator ?? 0));
      if (c.opponentUid) setWalletBalance(c.opponentUid, getWalletBalance(c.opponentUid) + (c.escrowedOpponent ?? 0));
    }
    c.settled = true; upsertChallenge(c); setCh({ ...c });
  }

  const header = (
    <div className="mb-4 flex items-center justify-between">
      <div>
        <div className="text-sm text-zinc-400">Challenge Code</div>
        <div className="text-2xl font-mono font-bold">{ch.code}</div>
      </div>
      <div className="text-sm text-zinc-400">Game: <span className="font-semibold text-white">{ch.gameType === 'SCOUT' ? '5 Numbers Scout' : ch.gameType === 'DOWN' ? '25 Down' : '25 Up'}</span></div>
    </div>
  );

  const onFinish = (ms: number) => { const res: Result = { rawMs: ms, finalMs: ms, finishedAt: Date.now() }; submit(res, role); };
  const bothAccepted = ch.creatorAccepted && ch.opponentAccepted;
  const bothDone = Boolean(ch.creatorResult && ch.opponentResult);

  return (
    <Shell showBack onBack={() => onNavigate({ name: 'app' })} authed={authed} uid={uid}>
      <div className="grid grid-cols-1 md:grid-cols-[1fr_360px] gap-6 items-start">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
          {header}
          {!bothAccepted && role === 'opponent' && (
            <div className="mb-4 p-3 rounded-lg bg-zinc-900 border border-zinc-800">
              <div className="text-sm">Accept stake: <span className="font-semibold">{ch.stake}</span> coins</div>
              <button onClick={acceptOpponent} className="mt-2 px-3 py-1.5 rounded-lg bg-white text-black font-semibold">Accept & Lock Stake</button>
              {err && <div className="text-xs text-red-400 mt-2">{err}</div>}
            </div>
          )}
          {bothAccepted && (
            <>
              {ch.gameType === 'SCOUT' && (<PlayableScout seed={ch.seed} onDone={onFinish} />)}
              {ch.gameType === 'DOWN' && (<PlayableDown seed={ch.seed} onDone={onFinish} />)}
              {ch.gameType === 'UP' && (<PlayableUp seed={ch.seed} onDone={onFinish} />)}
            </>
          )}
        </div>
        <aside className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
          <h3 className="text-lg font-bold mb-2">Status</h3>
          <ul className="text-sm text-zinc-400 space-y-1">
            <li>Creator: {ch.creatorAccepted ? <span className="text-green-400">Stake locked</span> : 'Waiting'}</li>
            <li>Opponent: {ch.opponentAccepted ? <span className="text-green-400">Stake locked</span> : role === 'opponent' ? 'You' : 'Waiting'}</li>
          </ul>
          <div className="mt-3 text-xs text-zinc-500">Stake each: <span className="text-white font-semibold">{ch.stake}</span> (pot {(ch.stake*2)})</div>
          <div className="mt-3 text-xs text-zinc-500">Seed: <span className="break-all">{ch.seed}</span></div>
          {bothDone && <ResultsCard ch={ch} />}
        </aside>
      </div>
    </Shell>
  );
}

function ResultsCard({ ch }: { ch: Challenge }) {
  if (!ch.creatorResult || !ch.opponentResult) return null;
  const a = ch.creatorResult.finalMs; const b = ch.opponentResult.finalMs; const diff = Math.abs(a - b);
  const winner = a < b ? 'Creator' : b < a ? 'Opponent' : 'Tie';
  return (
    <div className="mt-6 p-4 rounded-xl bg-zinc-900 border border-zinc-800">
      <h4 className="font-bold mb-2">Results</h4>
      <div className="text-sm font-mono">Creator: {a.toFixed(6)}s</div>
      <div className="text-sm font-mono">Opponent: {b.toFixed(6)}s</div>
      <div className="mt-2 text-sm">{winner === 'Tie' ? 'Tie — split stake' : `${winner} wins by ${diff.toFixed(6)}s`}</div>
    </div>
  );
}

/*******************************
 * PLAYABLE (seeded) — rAF timer 6-dp
 *******************************/
function PlayableScout({ seed, onDone }: { seed: string; onDone: (ms: number) => void }) {
  const grid = useMemo(() => gameGridFromSeed(seed), [seed]);
  const targets = useMemo(() => { const rnd = prngFromSeed('targets-' + seed); return seededPickUnique(Array.from({ length: 25 }, (_, i) => i + 1), 5, rnd); }, [seed]);
  const [started, setStarted] = useState(false); const [startTime, setStart] = useState<number | null>(null); const [now, setNow] = useState<number | null>(null); const [elapsed, setElapsed] = useState<string | null>(null); const [found, setFound] = useState<number[]>([]);
  useEffect(()=>{ let raf:number; if(started&&!elapsed){ const tick=()=>{ setNow(performance.now()); raf=requestAnimationFrame(tick);}; raf=requestAnimationFrame(tick);} return()=>{ if(raf) cancelAnimationFrame(raf);} },[started,elapsed]);
  const start = ()=>{ if(started) return; const t=performance.now(); setStarted(true); setStart(t); setNow(t); };
  const click=(n:number)=>{ if(!started||elapsed) return; if(targets.includes(n) && !found.includes(n)){ const nxt=[...found,n]; setFound(nxt); if(nxt.length===5 && startTime){ const secs=(performance.now()-startTime)/1000; setElapsed(secs.toFixed(6)); onDone(secs); } } };
  const live =(()=>{ if(!started||!startTime) return '0.000000'; if(elapsed) return Number(elapsed).toFixed(6); const s=((now??startTime)-startTime)/1000; return s.toFixed(6); })();
  const over = Boolean(elapsed);
  return (
    <div>
      <div className="flex items-center gap-3 mb-4">{!started && <button onClick={start} className="px-4 py-2 rounded-lg bg-white text-black font-semibold">Start</button>}<div className="text-lg tabular-nums font-mono">Time: {live}s</div></div>
      <div className="flex items-center gap-2 mb-3">{targets.map((t,i)=>(<span key={i} className={`px-3 py-1 rounded-full text-lg font-bold border ${found.includes(t)?'bg-green-500 text-black border-green-500':'bg-zinc-900 border-zinc-800'}`}>{t}</span>))}</div>
      <div className="grid grid-cols-5 gap-2 mb-2">{grid.map((num, idx)=>{ const hit=found.includes(num); const target=targets.includes(num); return (<button key={idx} onClick={()=>click(num)} className={`w-14 h-14 text-xl font-bold rounded-lg transition-colors ${hit?'bg-green-500 text-black':'bg-zinc-800 hover:bg-zinc-700'} ${target&&!hit?'ring-1 ring-zinc-600':''}`} disabled={hit||over}>{num}</button>); })}</div>
    </div>
  );
}

function PlayableDown({ seed, onDone }: { seed: string; onDone: (ms: number) => void }) {
  const grid = useMemo(() => gameGridFromSeed(seed), [seed]);
  const [started, setStarted] = useState(false); const [startTime, setStart] = useState<number | null>(null); const [now, setNow] = useState<number | null>(null); const [elapsed, setElapsed] = useState<string | null>(null); const [nextNum, setNext] = useState(25); const [found, setFound] = useState<Set<number>>(()=>new Set());
  useEffect(()=>{ let raf:number; if(started&&!elapsed){ const tick=()=>{ setNow(performance.now()); raf=requestAnimationFrame(tick);}; raf=requestAnimationFrame(tick);} return()=>{ if(raf) cancelAnimationFrame(raf);} },[started,elapsed]);
  const start = ()=>{ if(started) return; const t=performance.now(); setStarted(true); setStart(t); setNow(t); };
  const click=(n:number)=>{ if(!started||elapsed) return; if(n!==nextNum) return; setFound(prev=>new Set(prev).add(n)); if(nextNum===1 && startTime){ const secs=(performance.now()-startTime)/1000; setElapsed(secs.toFixed(6)); onDone(secs); } else { setNext(v=>v-1);} };
  const live =(()=>{ if(!started||!startTime) return '0.000000'; if(elapsed) return Number(elapsed).toFixed(6); const s=((now??startTime)-startTime)/1000; return s.toFixed(6); })();
  const over = Boolean(elapsed);
  return (
    <div>
      <div className="flex items-center gap-3 mb-4">{!started && <button onClick={start} className="px-4 py-2 rounded-lg bg-white text-black font-semibold">Start</button>}<div className="text-lg tabular-nums font-mono">Time: {live}s</div><div className="text-sm text-zinc-400">Next: <span className="font-bold text-white">{over?'-':nextNum}</span></div></div>
      <div className="grid grid-cols-5 gap-2 mb-2">{grid.map((num, idx)=>{ const hit=found.has(num); return (<button key={idx} onClick={()=>click(num)} className={`w-14 h-14 text-xl font-bold rounded-lg transition-colors ${hit?'bg-green-500 text-black':'bg-zinc-800 hover:bg-zinc-700'}`} disabled={hit||over}>{num}</button>); })}</div>
    </div>
  );
}

function PlayableUp({ seed, onDone }: { seed: string; onDone: (ms: number) => void }) {
  const grid = useMemo(() => gameGridFromSeed(seed), [seed]);
  const [started, setStarted] = useState(false); const [startTime, setStart] = useState<number | null>(null); const [now, setNow] = useState<number | null>(null); const [elapsed, setElapsed] = useState<string | null>(null); const [nextNum, setNext] = useState(1); const [found, setFound] = useState<Set<number>>(()=>new Set());
  useEffect(()=>{ let raf:number; if(started&&!elapsed){ const tick=()=>{ setNow(performance.now()); raf=requestAnimationFrame(tick);}; raf=requestAnimationFrame(tick);} return()=>{ if(raf) cancelAnimationFrame(raf);} },[started,elapsed]);
  const start = ()=>{ if(started) return; const t=performance.now(); setStarted(true); setStart(t); setNow(t); };
  const click=(n:number)=>{ if(!started||elapsed) return; if(n!==nextNum) return; setFound(prev=>new Set(prev).add(n)); if(nextNum===25 && startTime){ const secs=(performance.now()-startTime)/1000; setElapsed(secs.toFixed(6)); onDone(secs); } else { setNext(v=>v+1);} };
  const live =(()=>{ if(!started||!startTime) return '0.000000'; if(elapsed) return Number(elapsed).toFixed(6); const s=((now??startTime)-startTime)/1000; return s.toFixed(6); })();
  const over = Boolean(elapsed);
  return (
    <div>
      <div className="flex items-center gap-3 mb-4">{!started && <button onClick={start} className="px-4 py-2 rounded-lg bg-white text-black font-semibold">Start</button>}<div className="text-lg tabular-nums font-mono">Time: {live}s</div><div className="text-sm text-zinc-400">Next: <span className="font-bold text-white">{over?'-':nextNum}</span></div></div>
      <div className="grid grid-cols-5 gap-2 mb-2">{grid.map((num, idx)=>{ const hit=found.has(num); return (<button key={idx} onClick={()=>click(num)} className={`w-14 h-14 text-xl font-bold rounded-lg transition-colors ${hit?'bg-green-500 text-black':'bg-zinc-800 hover:bg-zinc-700'}`} disabled={hit||over}>{num}</button>); })}</div>
    </div>
  );
}

/*******************************
 * ROOT — lightweight router with deep links
 *******************************/
export default function Play4StakesRoot() {
  const [auth, setAuth] = useState(loadAuth());
  const uid = auth.uid || getUID();
  const [view, setView] = useState<View>({ name: 'landing' });

  // Deep-link support: /?code=ABCD&role=opponent or /?game=scout|down|up
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      const role = (params.get('role') as 'creator' | 'opponent') || 'opponent';
      const game = params.get('game');
      if (code) setView({ name: 'play', code: code.toUpperCase(), role });
      else if (game) {
        const map: any = { scout: 'SCOUT', down: 'DOWN', up: 'UP' };
        if (map[game]) setView({ name: 'game', which: map[game] });
      }
    } catch {}
  }, []);

  // Small helper to flip auth state (from AuthStub)
  const navigate = (v: View) => { setAuth(loadAuth()); setView(v); };

  if (view.name === 'landing') return <Landing onNavigate={navigate} />;
  if (view.name === 'auth') return <AuthStub onNavigate={navigate} redirect={view.redirect} />;
  if (view.name === 'app') return <AppLanding onNavigate={navigate} authed={auth.authed} uid={uid} />;
  if (view.name === 'game') return <GamePage title={view.which==='SCOUT'?'5 Numbers Scout':view.which==='DOWN'?'25 Down':'25 Up'} game={view.which} onNavigate={navigate} authed={auth.authed} uid={uid} />;
  if (view.name === 'play') return <PlayChallenge code={view.code} role={view.role} onNavigate={navigate} authed={auth.authed} uid={uid} />;
  return null;
}
