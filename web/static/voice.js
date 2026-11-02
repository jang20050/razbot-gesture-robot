// 라즈봇 목소리: a seedable creature-voice synth running in the browser (Web Audio).
// Ported from Pollen Robotics' microduck `sounds` crate (Apache-2.0):
// https://github.com/pollen-robotics/microduck/tree/main/sounds - personality.rs, voices.rs, synth.rs.
// One seed -> one Personality (pitch, timbre, vibrato, quackiness, tempo...): two seeds sound like two
// different creatures, the same seed always sounds the same. Each tag has variants so it never sounds canned.
// The random streams differ from the Rust original, so a given seed is not the same duck as on a microduck.
(function () {
  const TAU = Math.PI * 2;

  // ---------- rng (mulberry32 + Box-Muller) ----------
  function Rng(seed) {
    let a = seed >>> 0;
    const next = () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    let spare = null;
    return {
      random: next,
      uniform: (lo, hi) => lo + (hi - lo) * next(),
      integers: (lo, hi) => lo + Math.floor(next() * (hi - lo)),      // [lo, hi)
      choice: arr => arr[Math.floor(next() * arr.length)],
      normal() {
        if (spare !== null) { const s = spare; spare = null; return s; }
        let u = 0, v = 0;
        while (u === 0) u = next();
        v = next();
        const r = Math.sqrt(-2 * Math.log(u));
        spare = r * Math.sin(TAU * v);
        return r * Math.cos(TAU * v);
      },
    };
  }

  function crc32(str) {
    let c, crc = 0xFFFFFFFF;
    for (const b of new TextEncoder().encode(str)) {
      c = (crc ^ b) & 0xFF;
      for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xEDB88320 : c >>> 1;
      crc = (crc >>> 8) ^ c;
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  // ---------- personality ----------
  function personality(seed) {
    const rng = Rng(seed);
    // bimodal-ish register: some small & high, some big & low - the whole population sits low
    const register = rng.choice([-1, 0, 0, 1]) + rng.uniform(-0.4, 0.4);
    const base = rng.uniform(160, 380);
    const p = {
      seed,
      pitch: Math.min(620, Math.max(110, base * Math.pow(2, register * 0.45))),
      register,
      spread: rng.uniform(0.4, 1.2),
      glide: rng.uniform(-1, 1),
      brightness: rng.uniform(0.05, 0.55),
      tilt: rng.uniform(1.4, 2.8),
      nasal: rng.uniform(0.1, 1.0),
      skew: rng.uniform(-1, 1),
      formantN: rng.integers(1, 6),
      formantGain: rng.uniform(0, 1.4),
      vibRate: rng.uniform(3.5, 9.5),
      vibDepth: rng.uniform(0, 0.7),
      jitter: rng.uniform(0.03, 0.35),
      breath: rng.uniform(0, 0.30),
      quack: rng.uniform(0.2, 1.0),
      amRate: rng.uniform(18, 55),
      amDepth: rng.uniform(0.15, 0.70),
      warbleHz: rng.uniform(7, 18),
      warbleDepth: rng.uniform(0, 1.4),
      attackSharp: rng.uniform(0, 1),
      speed: rng.uniform(0.82, 1.22),
    };
    return p;
  }

  function harmonics(p) {
    const N = 7, w = [];
    for (let n = 1; n <= N; n++) {
      const base = 1 / Math.pow(n, p.tilt);
      const high = p.brightness * Math.pow(n / N, 1.5);
      const nasal = p.nasal * (n === 2 || n === 3 ? 0.6 : 0);
      const skew = p.skew >= 0 ? p.skew * (n % 2 === 0 ? 0.4 : -0.2) : -p.skew * (n % 2 === 0 ? -0.3 : 0.4);
      const formant = n === p.formantN ? p.formantGain : 0;
      w.push(Math.max(0, base + high + nasal + skew + formant * base * 1.5));
    }
    w[0] = Math.max(w[0], 0.7);           // keep f0 dominant so pitch is always perceptible
    return w;
  }

  const variantRng = (p, tag, variant) =>
    Rng((Math.imul(p.seed, 1000003) ^ crc32(tag) ^ Math.imul(variant, 2654435761)) >>> 0);

  // ---------- dsp primitives ----------
  let SR = 48000;
  const tAxis = dur => { const n = Math.max(1, Math.round(dur * SR)); const t = new Float32Array(n); for (let i = 0; i < n; i++) t[i] = i / SR; return t; };
  function lerp(t, pts) {
    const out = new Float32Array(t.length);
    for (let i = 0; i < t.length; i++) {
      const x = t[i];
      if (x <= pts[0][0]) { out[i] = pts[0][1]; continue; }
      let v = pts[pts.length - 1][1];
      for (let k = 0; k < pts.length - 1; k++) {
        const [x0, y0] = pts[k], [x1, y1] = pts[k + 1];
        if (x <= x1) { v = x1 <= x0 ? y1 : y0 + (y1 - y0) * (x - x0) / (x1 - x0); break; }
      }
      out[i] = v;
    }
    return out;
  }
  function expdecay(t, att, dec) {
    att = Math.max(att, 1e-4); dec = Math.max(dec, 1e-4);
    return t.map(x => Math.min(1, Math.max(0, x / att)) * Math.exp(-Math.max(0, x - att) / dec));
  }
  function bell(t, att, rel) {
    const total = t[t.length - 1], relStart = Math.max(0, total - rel);
    att = Math.max(att, 1e-4); rel = Math.max(rel, 1e-4);
    return t.map(x => { let v = 1; if (x < att) v = x / att; if (x > relStart) v = Math.max(0, 1 - (x - relStart) / rel); return Math.min(1, Math.max(0, v)); });
  }
  const vibrato = (t, rate, depth, ph) => (rate <= 0 || depth <= 0) ? t.map(() => 1)
    : t.map(x => Math.pow(2, depth * Math.sin(TAU * rate * x + ph) / 12));
  function jitter(t, depth, rng) {
    if (depth <= 0) return t.map(() => 1);
    const n = t.length, k = Math.max(1, Math.round(64 * SR / 22050)), raw = new Float32Array(n);
    for (let i = 0; i < n; i++) raw[i] = rng.normal();
    const out = new Float32Array(n), off = (k - 1) >> 1;
    let acc = 0;
    for (let i = -off; i < n; i++) {             // centred moving average ('same' mode)
      const add = i + off; if (add < n) acc += raw[add];
      const sub = i + off - k; if (sub >= 0) acc -= raw[sub];
      if (i >= 0) out[i] = Math.pow(2, depth * (acc / k) / 12);
    }
    return out;
  }
  function pink(n, rng) {
    const a = Math.pow(0.985, 22050 / SR), out = new Float32Array(n);
    let leak = 0, peak = 1e-9;
    for (let i = 0; i < n; i++) { leak = a * leak + rng.normal(); out[i] = leak; peak = Math.max(peak, Math.abs(leak)); }
    for (let i = 0; i < n; i++) out[i] /= peak;
    return out;
  }
  function normalise(x, db) {
    let peak = 1e-9;
    for (const v of x) peak = Math.max(peak, Math.abs(v));
    const g = Math.pow(10, db / 20) / peak;
    for (let i = 0; i < x.length; i++) x[i] *= g;
    return x;
  }
  const mul = (a, b) => a.map((v, i) => v * b[i]);
  function concat(...parts) {
    const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }
  const silence = sec => new Float32Array(Math.max(0, Math.round(sec * SR)));
  const attack = (p, dur, snappy) => Math.max(0.001, 0.04 * dur + (0.003 * dur - 0.04 * dur) * p.attackSharp * snappy);

  // shared core: harmonic osc + vibrato + jitter + (optional) AM buzz + breath
  function voice(p, t, freq, rng, amScale, breathScale) {
    const vib = vibrato(t, p.vibRate, p.vibDepth, rng.uniform(0, TAU));
    const jit = jitter(t, p.jitter, rng);
    const w = harmonics(p), out = new Float32Array(t.length);
    let acc = 0;
    for (let i = 0; i < t.length; i++) {
      acc += freq[i] * vib[i] * jit[i];
      const ph = TAU * acc / SR;
      let s = 0;
      for (let n = 0; n < w.length; n++) if (w[n]) s += w[n] * Math.sin((n + 1) * ph);
      out[i] = s;
    }
    const amD = p.amDepth * amScale * p.quack;              // quackiness gates the AM buzz
    if (amD > 0.01) for (let i = 0; i < t.length; i++) out[i] *= 1 - amD * (0.5 + 0.5 * Math.sin(TAU * p.amRate * t[i]));
    const br = p.breath * breathScale;
    if (br > 0) { const nz = pink(t.length, rng); for (let i = 0; i < t.length; i++) out[i] += br * nz[i]; }
    return out;
  }

  // ---------- recipes (microduck voices.rs) ----------
  function alarm(p, v) {
    const rng = variantRng(p, 'alarm', v);
    const dur = (0.20 + 0.12 * rng.random()) / p.speed, t = tAxis(dur);
    const f0 = p.pitch * (1.25 + 0.35 * p.spread) * (0.94 + 0.12 * rng.random());
    const peak = 1.15 + 0.25 * p.spread + 0.10 * rng.random(), fall = 0.75 + 0.20 * (1 - p.spread);
    const freq = lerp(t, [[0, f0], [0.05 * dur, f0 * peak], [dur, f0 * fall]]);
    const env = expdecay(t, attack(p, dur, 1), dur * (0.40 + 0.20 * rng.random()));
    const sig = mul(voice(p, t, freq, rng, 0.5, 1), env);
    const crackle = 0.04 + 0.10 * p.brightness;          // bright voices rasp, soft ones just yelp
    for (let i = 0; i < sig.length; i++) sig[i] += crackle * rng.normal() * env[i];
    return normalise(sig, -3);
  }
  function greetSyllable(p, rng, durScale, f0Scale) {
    const dur = (0.32 + 0.25 * rng.random()) * durScale / p.speed, t = tAxis(dur);
    const f0 = p.pitch * (0.9 + 0.15 * rng.random()) * f0Scale, bend = 0.10 + 0.15 * p.spread;
    const freq = lerp(t, [[0, f0 * (1 - p.glide * bend * 0.5)], [0.18 * dur, f0 * (1 + p.glide * bend)],
      [dur, f0 * (1 - p.glide * bend * 0.3) * (0.92 + 0.08 * rng.random())]]);
    return mul(voice(p, t, freq, rng, 1, 1), expdecay(t, attack(p, dur, 0.5), dur * 0.7));
  }
  function greet(p, v) {
    const rng = variantRng(p, 'greet', v);
    let sig = greetSyllable(p, rng, 1, 1);
    if (rng.random() < 0.4) {                             // "wak-wak" double quack
      const gap = silence((0.05 + 0.06 * rng.random()) / p.speed);
      sig = concat(sig, gap, greetSyllable(p, rng, 0.8, 0.95 + 0.06 * rng.random()));
    }
    return normalise(sig, -3);
  }
  function inquire(p, v) {
    const rng = variantRng(p, 'inquire', v);
    const dur = (0.42 + 0.25 * rng.random()) / p.speed, t = tAxis(dur);
    const f0 = p.pitch * (0.88 + 0.10 * rng.random());
    const rise = 1.15 + 0.50 * p.spread + 0.20 * Math.max(0, p.glide) + 0.10 * rng.random();
    const freq = lerp(t, [[0, f0 * 0.92], [0.30 * dur, f0 * 0.95], [dur, f0 * rise]]);
    const env = bell(t, dur * (0.06 + 0.10 * (1 - p.attackSharp)), dur * 0.32);
    return normalise(mul(voice(p, t, freq, rng, 0.6, 1), env), -3);
  }
  function peck(p, v) {
    const rng = variantRng(p, 'peck', v);
    const dur = (0.16 + 0.12 * rng.random()) / p.speed, t = tAxis(dur);
    const f0 = p.pitch * (0.45 + 0.20 * rng.random());
    const freq = lerp(t, [[0, f0 * 1.5], [0.04 * dur, f0], [dur, f0 * 0.80]]);
    const body = mul(voice(p, t, freq, rng, 0.3, 0.5), expdecay(t, attack(p, dur, 1), dur * 0.35));
    const clickLen = Math.min(body.length, Math.round((0.003 + 0.006 * p.attackSharp) * SR));
    const gain = 0.4 + 0.4 * p.attackSharp;               // snappy voices get a sharper "tock"
    for (let i = 0; i < clickLen; i++) { const f = 1 - i / clickLen; body[i] += gain * rng.uniform(-1, 1) * f * f; }
    return normalise(body, -3);
  }
  function chirpSyllable(p, rng, f0, dur, contour) {
    const t = tAxis(dur);
    const warble = vibrato(t, p.warbleHz, p.warbleDepth, rng.uniform(0, TAU));
    const shape = lerp(t, contour), freq = shape.map((c, i) => f0 * c * warble[i]);
    const soft = Object.assign({}, p, {quack: p.quack * 0.2, brightness: p.brightness * 0.5, formantGain: p.formantGain * 0.5});
    return mul(voice(soft, t, freq, rng, 1, 0.4), expdecay(t, attack(p, dur, 0.7), dur * 0.55));
  }
  function chirp(p, v) {
    const rng = variantRng(p, 'chirp', v), f0 = p.pitch * (0.95 + 0.75 * rng.random());
    let sig;
    switch (v % 4) {                                      // rise, fall, trill, double
      case 0: { const d = (0.10 + 0.10 * rng.random()) / p.speed, pk = 1.12 + 0.10 * rng.random();
        sig = chirpSyllable(p, rng, f0, d, [[0, 0.88], [0.5 * d, pk], [d, 1.05]]); break; }
      case 1: { const d = (0.10 + 0.10 * rng.random()) / p.speed, st = 1.12 + 0.10 * rng.random();
        sig = chirpSyllable(p, rng, f0, d, [[0, st], [0.3 * d, 1.0], [d, 0.78]]); break; }
      case 2: { const d = (0.22 + 0.14 * rng.random()) / p.speed;
        const trill = Object.assign({}, p, {warbleDepth: Math.max(p.warbleDepth, 0.7) * 1.6});
        sig = chirpSyllable(trill, rng, f0, d, [[0, 1.0], [0.5 * d, 1.06], [d, 0.94]]); break; }
      default: { const d = (0.08 + 0.05 * rng.random()) / p.speed;
        const a = chirpSyllable(p, rng, f0, d, [[0, 0.95], [0.4 * d, 1.10], [d, 0.88]]);
        const gap = silence((0.03 + 0.03 * rng.random()) / p.speed), db = d * 0.9;
        const b = chirpSyllable(p, rng, f0 * (0.92 + 0.10 * rng.random()), db, [[0, 0.95], [0.4 * db, 1.10], [db, 0.88]]);
        sig = concat(a, gap, b); }
    }
    return normalise(sig, -6);
  }
  function coo(p, v) {
    const rng = variantRng(p, 'coo', v);
    const dur = (0.85 + 0.55 * rng.random()) / p.speed, t = tAxis(dur);
    const f0 = p.pitch * (0.42 + 0.15 * (1 - p.attackSharp)) * (0.94 + 0.12 * rng.random());
    const drift = 1 + 0.05 * rng.random() + 0.04 * p.glide;
    const freq = lerp(t, [[0, f0 * 0.94], [dur * 0.5, f0 * drift], [dur, f0 * 0.90]]);
    const env = bell(t, dur * (0.18 + 0.10 * (1 - p.attackSharp)), dur * 0.30);
    const soft = Object.assign({}, p, {breath: Math.max(p.breath, 0.12) + 0.10, quack: p.quack * 0.25,
      amRate: p.amRate * 0.30, vibRate: p.vibRate * 0.45, vibDepth: p.vibDepth * 0.7});
    return normalise(mul(voice(soft, t, freq, rng, 1, 1), env), -5);
  }
  function wheee(p, v) {                                  // one ride: start, loop, end in a single sweep
    const rng = variantRng(p, 'wheee', v);
    const ds = (0.80 + 0.30 * rng.random()) / p.speed, dl = (0.90 + 0.40 * rng.random()) / p.speed;
    const de = (0.55 + 0.25 * rng.random()) / p.speed, total = ds + dl + de, t = tAxis(total);
    const t1 = ds, t2 = ds + dl, f0 = p.pitch * (0.95 + 0.10 * rng.random());
    const top = 1.6 + 0.5 * p.spread + 0.25 * rng.random();
    const base = lerp(t, [[0, f0 * 0.85], [0.15 * ds, f0], [t1, f0 * top], [t2, f0 * top], [t2 + 0.25 * de, f0 * top * 1.04], [total, f0 * 0.60]]);
    const wobHz = 4.5 + 3.0 * rng.random(), swell = lerp(t, [[0, 0.15], [t1, 1], [total, 1]]);
    const freq = base.map((f, i) => f * Math.pow(2, 0.5 * swell[i] * Math.sin(TAU * wobHz * t[i]) / 12));
    const env = lerp(t, [[0, 0], [Math.min(0.06, 0.5 * ds), 1], [t2 + 0.40 * de, 1], [total, 0]]);
    const joy = Object.assign({}, p, {vibDepth: p.vibDepth * 0.5, quack: p.quack * 0.5});
    return normalise(mul(voice(joy, t, freq, rng, 0.5, 0.5), env), -4);
  }
  const RECIPES = {alarm, greet, inquire, peck, chirp, coo, wheee};
  const VARIANTS = {greet: 12, chirp: 12, wheee: 6};

  // ---------- emotions -> phrases (sequences of tags) ----------
  // keys are the buzzer rhythm names the robot already uses for each reaction (companion.SOUNDS)
  const PHRASES = {
    hello: ['greet'], happy: ['chirp', 'chirp'], love: ['coo'], night: ['coo'], sad: ['coo'],
    surprised: ['alarm'], scared: ['alarm', 'alarm'], call: ['inquire', 'inquire'], confused: ['inquire'],
    treat: ['peck', 'peck', 'peck', 'chirp'], levelup: ['wheee'], trick: ['chirp', 'greet'],
    win: ['chirp', 'chirp', 'chirp'], lose: ['coo'], dead: ['alarm', 'coo'], tick: ['peck'],
  };

  let ctx = null, master = null, p = null, seed = null, vol = 0.8;
  const cache = {};
  let busyUntil = 0;

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      SR = ctx.sampleRate;
      master = ctx.createGain();
      master.gain.value = vol;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function render(tag, variant) {
    const key = `${seed}:${tag}:${variant}:${SR}`;
    if (!cache[key]) cache[key] = RECIPES[tag](p, variant);
    return cache[key];
  }

  // play a sequence of tags back to back (gap between syllables), each with a random variant
  function playTags(tags, gap = 0.07) {
    if (!p || !ensure()) return false;
    if (ctx.state !== 'running') {                          // waking up after a user gesture: play when ready
      ctx.resume().then(() => { if (ctx.state === 'running') playTags(tags, gap); }).catch(() => {});
      return false;
    }
    let when = Math.max(ctx.currentTime + 0.02, busyUntil);
    for (const tag of tags) {
      const n = VARIANTS[tag] || 10;
      const data = render(tag, Math.floor(Math.random() * n));
      const buf = ctx.createBuffer(1, data.length, SR);
      buf.copyToChannel(data, 0);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(master);
      src.start(when);
      when += data.length / SR + gap;
    }
    busyUntil = when;
    return true;
  }

  // a human description of the voice, for the page
  function describe(pp) {
    const pitch = pp.pitch < 200 ? '낮고 굵은' : pp.pitch < 300 ? '중간 높이의' : pp.pitch < 420 ? '높은' : '아주 높고 가는';
    const tone = pp.quack > 0.7 ? '꽥꽥거리는' : pp.quack > 0.45 ? '살짝 꽥꽥한' : '맑은';
    const tempo = pp.speed > 1.1 ? '재잘재잘 빠르게' : pp.speed < 0.92 ? '느긋하게' : '또박또박';
    const extra = pp.breath > 0.2 ? '숨소리 섞인' : pp.vibDepth > 0.45 ? '떨리는' : pp.warbleDepth > 1 ? '지저귀는' : '또렷한';
    return {summary: `${pitch} ${tone} 목소리 · ${tempo} 말해요`, traits: [
      ['음높이', Math.round(pp.pitch) + 'Hz'], ['꽥꽥', Math.round(pp.quack * 100) + '%'],
      ['빠르기', pp.speed.toFixed(2) + '배'], ['음색', extra]]};
  }

  window.RazVoice = {
    TAGS: Object.keys(RECIPES),
    PHRASES,
    setSeed(s) { s = s >>> 0; if (s !== seed) { seed = s; p = personality(s); } },
    unlock() { return ensure(); },                         // call from a user gesture
    get ready() { return !!ctx && ctx.state === 'running'; },
    say(emotion) { const tags = PHRASES[emotion]; return tags ? playTags(tags) : false; },
    play(tag) { return RECIPES[tag] ? playTags([tag]) : false; },
    describe() { return p ? describe(p) : null; },
    set volume(v) { vol = Math.max(0, v); if (master) master.gain.value = vol; },   // remembered until audio starts
    get volume() { return vol; },
    // offline rendering for tests: Float32Array of one tag/variant at `rate`
    _render(tag, variant = 0, rate = 48000) { const old = SR; SR = rate; try { return RECIPES[tag](p, variant); } finally { SR = old; } },
  };
})();
