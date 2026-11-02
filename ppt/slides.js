// 공감을 교류하는 라즈봇 - interactive web slides.
// Served by the robot program (app.py) at /ppt/, so the live widgets (face, camera, reactions, the app) talk to the
// same robot without any browser permission. Opened as a plain file it falls back to http://localhost:5000.
(() => {
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const API = location.protocol === 'file:' ? 'http://localhost:5000' : '';
  const api = p => API + p;
  const post = p => fetch(api(p), {method: 'POST'}).catch(() => null);

  const slides = $$('.slide');
  let cur = 0;

  // ---------- fit the 1600x900 stage to the window ----------
  function fit() {
    const s = Math.min(innerWidth / 1600, innerHeight / 900);
    $('#deck').style.transform = `scale(${s})`;
  }
  addEventListener('resize', fit);
  fit();

  // ---------- navigation ----------
  function go(i, fromHash) {
    i = Math.max(0, Math.min(slides.length - 1, i));
    const prev = cur;
    slides.forEach((s, k) => {
      s.classList.toggle('on', k === i);
      s.classList.toggle('left', k < i);
    });
    cur = i;
    $('#count').textContent = `${i + 1} / ${slides.length}`;
    $('#progress').style.width = ((i + 1) / slides.length * 100) + '%';
    $('#notes').textContent = slides[i].dataset.notes || '';
    if (!fromHash) history.replaceState(null, '', '#' + (i + 1));
    onLeave(slides[prev]);
    onEnter(slides[i]);
    $$('.overview button').forEach((b, k) => b.classList.toggle('on', k === i));
  }
  const next = () => go(cur + 1), prevS = () => go(cur - 1);
  $('#next').onclick = next;
  $('#prev').onclick = prevS;

  addEventListener('keydown', e => {
    if (e.target.isContentEditable || /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    const k = e.key;
    if (['ArrowRight', 'PageDown', ' '].includes(k)) { e.preventDefault(); next(); }
    else if (['ArrowLeft', 'PageUp'].includes(k)) { e.preventDefault(); prevS(); }
    else if (k === 'Home') go(0);
    else if (k === 'End') go(slides.length - 1);
    else if (k === 'f' || k === 'F') toggleFs();
    else if (k === 'o' || k === 'O') toggleOverview();
    else if (k === 'n' || k === 'N') $('#notes').classList.toggle('hide');
    else if (k === 'b' || k === 'B') document.body.classList.toggle('black');
    else if (k === 'Escape') { $('#overview').classList.add('hide'); $$('.framewrap.zoom').forEach(f => f.classList.remove('zoom')); }
  });

  function toggleFs() {
    if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {});
  }
  $('#fsBtn').onclick = toggleFs;
  $('#notesBtn').onclick = () => $('#notes').classList.toggle('hide');

  const ov = $('#overview');
  ov.innerHTML = slides.map((s, k) => `<button data-go="${k}"><b>${k + 1}</b>${s.dataset.title || ''}</button>`).join('');
  function toggleOverview() { ov.classList.toggle('hide'); }
  $('#ovBtn').onclick = toggleOverview;
  ov.onclick = e => { const b = e.target.closest('[data-go]'); if (b) { go(+b.dataset.go); ov.classList.add('hide'); } };

  let barTimer;
  addEventListener('mousemove', () => {
    document.body.classList.add('showbar');
    clearTimeout(barTimer);
    barTimer = setTimeout(() => document.body.classList.remove('showbar'), 1800);
  });

  // presentation timer
  let t0 = Date.now();
  setInterval(() => {
    const s = Math.floor((Date.now() - t0) / 1000);
    $('#timer').textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }, 1000);
  $('#timer').onclick = () => { t0 = Date.now(); };

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.remove('hide');
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hide'), 2200);
  }

  // ---------- live robot state ----------
  const MOOD = {neutral: '😐 평온', happy: '😊 기쁨', sleepy: '😴 졸림', bored: '🥱 심심', surprised: '😮 놀람',
    love: '🥰 사랑', shy: '☺️ 부끄럼', sulky: '😤 삐짐', scared: '😨 무서움'};
  let S = null, lastEv = null, online = false, voiceSeedSet = false;

  async function poll() {
    try {
      const r = await fetch(api('/game/state'), {cache: 'no-store'});
      S = await r.json();
      setOnline(true);
      render();
    } catch (e) { setOnline(false); }
    setTimeout(poll, 600);
  }
  function setOnline(on) {
    if (on === online) return;
    online = on;
    document.body.classList.toggle('online', on);
    $('#conn').textContent = on ? '● 라즈봇 연결됨' : '● 라즈봇 연결 안 됨';
  }
  function setLive(key, text) { $$(`[data-live="${key}"]`).forEach(el => { if (el.textContent !== text) el.textContent = text; }); }

  function render() {
    const g = S.game, pet = S.pet;
    setLive('mood', (MOOD[pet.mood] || pet.mood) + (pet.sleeping ? ' · 쿨쿨' : ''));
    setLive('behavior', pet.behavior || '');
    setLive('label', S.label_ko);
    setLive('level', `Lv ${g.level} · 호감도 ${g.xp}`);
    $$('[data-live="camoff"]').forEach(el => el.classList.toggle('hide', S.camera.on));
    const ev = pet.events[0];
    if (ev && ev.id !== lastEv) {
      setLive('bubble', ev.text);
      if (lastEv !== null) {
        $$('.live-bubble').forEach(b => { b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); });
        if (window.RazVoice && voiceOn) RazVoice.say(ev.sound);
      }
      lastEv = ev.id;
    } else if (!ev) setLive('bubble', '안녕! 반가워요 👋');
    $$('.mn').forEach(n => n.classList.toggle('on', n.dataset.mood === pet.mood));
    $$('#levels [data-lv]').forEach(d => {
      const lv = +d.dataset.lv;
      d.classList.toggle('done', lv < g.level);
      d.classList.toggle('now', lv === g.level);
    });
    if (!voiceSeedSet && window.RazVoice && g.voice_seed !== undefined) {
      RazVoice.setSeed(g.voice_seed); voiceSeedSet = true; describeVoice('우리 라즈봇');
    }
    syncCam();
  }

  // faces refresh only on the visible slide
  setInterval(() => {
    if (!online) return;
    slides[cur].querySelectorAll('img.liveface').forEach(img => { img.src = api('/face.png?' + Date.now()); });
  }, 250);
  $$('img[data-face]').forEach(img => { img.src = api(`/face.png?expr=${img.dataset.face}&color=7fe9ff`); });

  // camera stream only while its slide is shown and the camera is on
  function syncCam() {
    $$('img.livecam').forEach(img => {
      const want = img.closest('.slide') === slides[cur] && S && S.camera.on;
      const src = want ? api('/video') : '';
      if ((img.getAttribute('src') || '') !== src) img.setAttribute('src', src);
    });
  }

  // ---------- slide enter / leave ----------
  function onEnter(s) {
    s.querySelectorAll('iframe[data-src]').forEach(f => { if (!f.getAttribute('src')) f.src = api(f.dataset.src); });
    if (s.querySelector('#cardCanvas')) drawCard();
    if (s.querySelector('#video')) loadVideos();
    syncCam();
  }
  function onLeave(s) {
    if (!s) return;
    s.querySelectorAll('video').forEach(v => v.pause());
  }

  // ---------- generic interactions ----------
  document.addEventListener('click', e => {
    const b = e.target.closest('button,[data-step]');
    if (!b) return;
    if (window.RazVoice) RazVoice.unlock();                   // any click lets the page make sound
    if (b.dataset.step !== undefined) tabs(b, '[data-step]', '.sb', +b.dataset.step);
    if (b.dataset.hw !== undefined) tabs(b, '[data-hw]', '.hi', +b.dataset.hw);
    if (b.dataset.fb !== undefined) tabs(b, '[data-fb]', '.fi', +b.dataset.fb + 1);
    if (b.dataset.pet) { post('/pet/' + b.dataset.pet); }
    if (b.dataset.mood) { post('/pet/mood/' + b.dataset.mood); toast((MOOD[b.dataset.mood] || '') + ' 기분으로 바꿨어요'); }
    if (b.dataset.camera) { post('/camera/' + b.dataset.camera); }
    if (b.dataset.say && window.RazVoice) setTimeout(() => RazVoice.say(b.dataset.say), 40);
    if (b.dataset.beep) beep(b.dataset.beep);
    if (b.dataset.sim) sim(b.dataset.sim);
    if (b.dataset.tpl) { tpl = b.dataset.tpl; $$('#cardChips button').forEach(x => x.classList.toggle('on', x === b)); drawCard(); }
    if (b.dataset.reload) { const f = document.getElementById(b.dataset.reload); f.src = f.src; }
    if (b.dataset.zoom) document.getElementById(b.dataset.zoom).parentElement.classList.toggle('zoom');
  });

  function tabs(btn, btnSel, paneSel, paneIdx) {
    const slide = btn.closest('.slide');
    slide.querySelectorAll(btnSel).forEach(x => x.classList.toggle('on', x === btn));
    slide.querySelectorAll(paneSel).forEach((p, k) => p.classList.toggle('on', k === paneIdx));
  }

  // ---------- buzzer demo (same rule as robot.BUZZ) ----------
  const LEN = {xs: [0.03, 0.03], s: [0.08, 0.12], m: [0.08, 0.2], l: [0.4, 0.3], xl: [0.8, 0]};
  let actx = null;
  async function beep(spec) {
    const [n, len] = spec.split(':');
    const [on, off] = LEN[len];
    const viz = $('#beepviz');
    viz.innerHTML = Array.from({length: +n}, () => `<i style="width:${Math.max(26, on * 300)}px"></i>`).join('');
    const bars = [...viz.children];
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    for (let k = 0; k < +n; k++) {
      bars[k].classList.add('lit');
      const o = actx.createOscillator(), gn = actx.createGain();
      o.type = 'square'; o.frequency.value = 2300; gn.gain.value = 0.04;           // a piezo-like tone
      o.connect(gn).connect(actx.destination); o.start(); o.stop(actx.currentTime + on);
      await new Promise(r => setTimeout(r, on * 1000));
      bars[k].classList.remove('lit');
      await new Promise(r => setTimeout(r, off * 1000));
    }
  }

  // ---------- voice ----------
  const voiceOn = true;
  function describeVoice(who) {
    const d = window.RazVoice && RazVoice.describe();
    if (d) $('#voiceDesc').textContent = `${who}: ${d.summary}`;
  }
  $('#voiceShuffle').onclick = () => {
    RazVoice.setSeed(Math.floor(Math.random() * 2 ** 32));
    describeVoice('다른 라즈봇');
    setTimeout(() => RazVoice.say('hello'), 40);
  };

  // ---------- training simulator (same rule as petgame.py) ----------
  let prof = 0, tries = 0;
  function sim(kind) {
    if (kind === 'reset') { prof = 0; tries = 0; $('#simLog').textContent = '버튼을 눌러 훈련해 보세요'; }
    else if (prof < 100) {
      tries++;
      const success = Math.random() < 0.3 + 0.7 * prof / 100;
      let delta, msg;
      if (kind === 'good') {
        [delta, msg] = success ? [15, '✅ 맞게 했어요 → 👍 칭찬! 숙련도 +15%'] : [5, '❌ 틀렸어요 → ✋ 바로잡기, 숙련도 +5%'];
      } else {
        [delta, msg] = success ? [15, '✅ 맞게 했어요 → 👍 칭찬! +15%'] : [-5, '❌ 틀렸는데 👍 칭찬… 헷갈려요 −5%'];
      }
      prof = Math.max(0, Math.min(100, prof + delta));
      $('#simLog').textContent = prof >= 100 ? `🏆 마스터! ${tries}번 만에 배웠어요` : msg;
    }
    $('#simFill').style.width = prof + '%';
    $('#simPct').textContent = prof + '%';
    $('#simCount').textContent = tries ? `훈련 ${tries}번` : '';
  }

  // ---------- 라즈봇 card ----------
  let tpl = 'passport';
  async function drawCard() {
    if (!window.RazCard) return;
    try {
      const d = await (await fetch(api('/game/card'), {cache: 'no-store'})).json();
      await RazCard.draw($('#cardCanvas'), d, {template: tpl, season: 'none', format: 'wide', photo: 'robot', media: api});
    } catch (e) { toast('라즈봇에 연결되면 카드가 그려져요'); }
  }

  // ---------- video ----------
  const video = $('#video');
  let videosLoaded = false;
  function showVideo(src, name) {
    video.src = src;
    $('#videoEmpty').classList.add('hide');
    $$('#videoList button').forEach(b => b.classList.toggle('on', b.dataset.v === name));
  }
  async function loadVideos() {
    if (videosLoaded) return;
    videosLoaded = true;
    try {
      const list = await (await fetch(api('/ppt/media-list'), {cache: 'no-store'})).json();
      $('#videoList').innerHTML = list.map(n => `<button data-v="${n}">🎬 ${n}</button>`).join('');
      if (list.length) showVideo(api('/ppt/media/' + encodeURIComponent(list[0])), list[0]);
    } catch (e) { /* no robot server: drop a file instead */ }
  }
  $('#videoList').onclick = e => {
    const b = e.target.closest('[data-v]');
    if (b) showVideo(api('/ppt/media/' + encodeURIComponent(b.dataset.v)), b.dataset.v);
  };
  const drop = $('#videoDrop');
  ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, () => drop.classList.remove('drag')));
  drop.addEventListener('drop', e => {
    e.preventDefault();
    const f = [...e.dataTransfer.files].find(x => x.type.startsWith('video/'));
    if (f) showVideo(URL.createObjectURL(f), f.name);
  });
  $('#videoPick').onchange = e => { const f = e.target.files[0]; if (f) showVideo(URL.createObjectURL(f), f.name); };

  // ---------- start ----------
  post('/game/act/enter');                                   // companion mode: moods and reactions are live
  poll();
  go((parseInt(location.hash.slice(1), 10) || 1) - 1, true);
  addEventListener('hashchange', () => go((parseInt(location.hash.slice(1), 10) || 1) - 1, true));
})();
