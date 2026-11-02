// 라즈봇 키우기 - pet game page
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

const MOOD = {neutral: '😐 평온', happy: '😊 기쁨', sleepy: '😴 졸림', bored: '🥱 심심', surprised: '😮 놀람',
  love: '🥰 사랑', shy: '☺️ 부끄럼', sulky: '😤 삐짐', scared: '😨 무서움'};
const KIND = {gesture: '손짓', button: '버튼', passive: '자동', training: '훈련'};
const RPS = {rock: '✊', paper: '✋', scissors: '✌️'};

let G = null;              // last state
let lastSeq = null;        // last notice shown
let lastBubble = '';
let lastLevel = null;
let synced = false;
let seq = null;            // custom routine being edited
let seqDirty = false;
const sigs = {};           // render signatures to avoid rebuilding unchanged lists

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hide');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.add('hide'), 2600);
}

// ---------- connection to the robot ----------
// Served by the robot itself (app.py) -> same origin. Hosted elsewhere (Vercel) -> the robot address the
// player entered: http://localhost:5000 for a PC, or an https tunnel + access code for a Raspberry Pi.
const conn = {base: '', token: '', remote: false, ok: false, fails: 0};

const api = path => conn.base + path;
function media(path) {                  // <img> can't send headers, so the access code rides in the URL
  if (!conn.token) return api(path);
  return api(path) + (path.includes('?') ? '&' : '?') + 't=' + encodeURIComponent(conn.token);
}
// Chrome's Local Network Access: a public https page may reach this PC / the home network only when the
// request says so (and the user allows it); this also lifts mixed-content blocking for http://192.168... robots.
function addressSpace(url) {
  if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(url)) return 'loopback';
  if (/^https?:\/\/(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|[a-z0-9-]+\.local(:|\/|$))/.test(url)) return 'local';
  return undefined;
}
function apiFetch(path, opt = {}) {
  const headers = Object.assign({}, opt.headers);
  if (conn.token) headers['X-Razbot-Token'] = conn.token;
  const space = conn.remote ? addressSpace(conn.base) : undefined;
  return fetch(api(path), Object.assign({}, opt, {headers}, space ? {targetAddressSpace: space} : {}));
}

async function act(action, data) {
  try {
    const r = await apiFetch('/game/act/' + action, {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(data || {})});
    const j = await r.json();
    if (!j.ok && j.msg) toast(j.msg);
    poll(true);
    return j;
  } catch (e) { toast('라즈봇과 연결이 끊겼어요'); }
}
const post = path => apiFetch(path, {method: 'POST'});

function setHTML(key, el, html) {
  if (sigs[key] === html) return;
  sigs[key] = html;
  el.innerHTML = html;
}

// ---------- header ----------
function renderTop(g) {
  $('lv').textContent = g.level;
  if (lastLevel !== null && g.level > lastLevel) {
    $('lv').parentElement.classList.remove('pop'); void $('lv').offsetWidth; $('lv').parentElement.classList.add('pop');
  }
  lastLevel = g.level;
  if ($('nameInput').classList.contains('hide')) $('name').textContent = g.name;
  $('days').textContent = `함께한 지 ${g.days}일`;
  $('streak').textContent = `🔥 ${g.streak}일 연속`;
  $('streak').classList.toggle('hide', !g.streak);
  const pct = g.xp_need ? Math.round(g.xp_cur / g.xp_need * 100) : 100;
  $('xpfill').style.width = pct + '%';
  $('xptext').textContent = g.xp_need
    ? `호감도 ${g.xp_cur} / ${g.xp_need} · 다음 레벨까지 ${g.xp_need - g.xp_cur} XP${g.demo ? ' · ⚡빠른 성장' : ''}`
    : `최고 레벨! 호감도 ${g.xp} 🏆`;
}

// ---------- hero ----------
function actionButtons(g, pet) {
  const u = Object.fromEntries(g.unlocks.map(x => [x.id, x]));
  const btn = (id, cls, label, sub, cond) => {
    const lock = u[id] && !u[id].unlocked;
    return `<button class="btn ${cls}" data-act="${id}" ${lock || cond === false ? 'disabled' : ''}>${label}<small>${lock ? '🔒 Lv' + u[id].level + '에 열려요' : sub}</small></button>`;
  };
  return [
    btn('treat', '', '🍪 간식 주기', `오늘 ${g.treats_left}번 남음`, g.treats_left > 0),
    pet.sleeping ? btn('wake', 'mint', '☀️ 깨우기', '에너지 충전 중') : btn('sleep', 'mint', '💤 재우기', '에너지 회복'),
    btn('rps', '', '✊ 가위바위보', '구호에 맞춰 손 내기'),
    btn('come', 'mint', '👉 이리 와', '손 쪽으로 다가와요'),
  ].join('');
}

function renderHero(g, pet, s) {
  const ev = pet.events[0];
  const text = ev ? ev.text : '';
  if (text && text + ev.time !== lastBubble) {
    lastBubble = text + ev.time;
    $('bubble').textContent = text;
    $('bubble').classList.remove('new'); void $('bubble').offsetWidth; $('bubble').classList.add('new');
  }
  $('mood').textContent = (MOOD[pet.mood] || pet.mood) + (pet.sleeping ? ' · 쿨쿨' : '');
  $('behav').textContent = s.motion ? pet.behavior : '';
  $('happy').style.width = g.happiness + '%'; $('happyN').textContent = g.happiness;
  $('energy').style.width = g.energy + '%'; $('energyN').textContent = g.energy;
  setHTML('actions', $('actions'), actionButtons(g, pet));
  $('label').textContent = s.label_ko;
}

function renderActivity(a) {
  const box = $('activity');
  box.classList.toggle('hide', !a);
  document.querySelector('.hero').classList.toggle('busy', !!a);
  if (!a) return;
  let title = '', big = '', btns = '';
  const stop = '<button class="btn ghost" data-act="stop">그만하기</button>';
  if (a.type === 'train') {
    const t = (G.game.tricks.find(x => x.id === a.trick) || {});
    title = `🎓 훈련 · ${t.icon || ''} ${t.name || ''}`;
    big = {start: '🎓', cue: a.cue_icon || '✋', acting: '👀', reward: '👍 ✋'}[a.phase] || '';
    if (a.phase === 'reward') btns = '<button class="btn mint" data-act="good">👍 잘했어</button><button class="btn" data-act="bad">✋ 아니야</button>';
    else if (a.phase !== 'done') btns = stop;
    if (a.phase === 'done') {
      big = a.result === 'good' ? '💕' : a.result === 'bad' ? '🤔' : '😶';
      if (a.delta !== undefined) {
        const d = a.delta;
        btns = `<div class="profdelta ${d < 0 ? 'neg' : ''}">숙련도 ${d >= 0 ? '+' : ''}${d}% → ${a.prof}%</div>`;
      }
    }
  } else if (a.type === 'rps') {
    title = '✊✌️✋ 가위바위보';
    big = a.phase === 'show' ? `🤖 ${RPS[a.robot]}` : a.phase === 'done' && a.robot
      ? `🤖${RPS[a.robot]} <small style="font-size:28px">vs</small> ${a.player ? RPS[a.player] : '❔'}🙂` : '✊';
    if (a.phase !== 'done') btns = stop;
  } else if (a.type === 'come') {
    title = '👉 이리 와';
    big = a.phase === 'done' ? (a.result === 'good' ? '🥰' : '🥺') : '👉';
    if (a.phase !== 'done') btns = stop;
  }
  $('actTitle').textContent = title;
  $('actBig').innerHTML = big;
  $('actMsg').textContent = a.msg || '';
  setHTML('actBtns', $('actBtns'), btns);
}

// ---------- tabs ----------
function renderBook(g) {
  const nxt = g.level < g.max_level
    ? `🔓 <b>Lv${g.level + 1}</b>이 되면: ${g.next_unlocks.length ? g.next_unlocks.map(esc).join(', ') : '더 깊은 우정'}`
    : '🏆 모든 교감을 열었어요! 최고의 친구예요';
  setHTML('next', $('next'), nxt);
  const items = g.unlocks.map(u => `<div class="unlock ${u.unlocked ? '' : 'locked'} ${!u.unlocked && u.level === g.level + 1 ? 'soon' : ''}">
    <span class="lv">${u.unlocked ? '✅' : '🔒'} Lv${u.level}</span><div class="ic">${u.icon}</div>
    <b>${esc(u.name)}<span class="kind">${KIND[u.kind]}</span></b><div class="how">${esc(u.how)}</div></div>`).join('');
  setHTML('unlocks', $('unlocks'), items);
}

function renderTricks(g, s) {
  const trainOk = g.unlocks.find(u => u.id === 'train').unlocked;
  const busy = !!g.activity;
  const html = g.tricks.map(t => {
    const locked = !t.unlocked || !trainOk;
    const label = locked ? `🔒 Lv${t.level}에 배워요` : t.mastered ? '🔁 다시 연습' : '🎓 훈련하기';
    return `<div class="trick ${locked ? 'locked' : ''} ${t.mastered ? 'mastered' : ''}">
      <span class="lv">Lv${t.level}</span><div class="ic">${t.icon}</div><b>${esc(t.name)}</b>
      <div class="how">신호: ${t.cue_icon} ${esc(t.cue_text)}</div>
      <div class="prof"><div style="width:${t.prof}%"></div></div>
      <div class="how">${t.mastered ? '🏆 마스터! 신호만 보여 주면 해요' : '숙련도 ' + t.prof + '%'}</div>
      <button class="btn ${t.mastered ? 'ghost' : 'mint'}" data-train="${t.id}" ${locked || busy ? 'disabled' : ''}>${label}</button></div>`;
  }).join('');
  setHTML('tricks', $('tricks'), html);

  const custom = g.tricks.find(t => t.id === 'custom');
  $('composer').classList.toggle('hide', !custom.unlocked);
  if (custom.unlocked) {
    if (!seqDirty) seq = [...g.custom_steps];
    setHTML('seq', $('seq'), seq.length
      ? seq.map((k, i) => `<button data-del="${i}" title="눌러서 빼기">${i + 1}. ${esc(s.steps[k])} ✕</button>`).join('')
      : '<span class="mut">아래 동작을 눌러 순서대로 담아 주세요</span>');
    setHTML('palette', $('palette'), Object.entries(s.steps).map(([k, v]) => `<button data-add="${k}">+ ${esc(v)}</button>`).join(''));
  }
}

function renderQuests(g) {
  $('streakbox').textContent = g.streak ? `🔥 ${g.streak}일 연속으로 할 일을 다 했어요!` : '오늘 할 일을 모두 끝내면 연속 기록이 시작돼요 🔥';
  setHTML('quests', $('quests'), g.quests.map(q => `<div class="quest ${q.done ? 'done' : ''}">
    <div class="check">${q.done ? '✓' : ''}</div>
    <div><div class="qt">${esc(q.text)}</div><div class="qbar"><div style="width:${q.progress / q.target * 100}%"></div></div></div>
    <div class="xp">${q.progress}/${q.target} · +${q.xp}</div></div>`).join(''));
  setHTML('records', $('records'), `
    <div>오늘 함께한 시간<b>${g.together_min_today}분</b></div>
    <div>총 함께한 시간<b>${g.together_hours}시간</b></div>
    <div>호감도 누적<b>${g.xp} XP</b></div>
    <div>가위바위보 (라즈봇)<b>${g.rps.win}승 ${g.rps.lose}패 ${g.rps.draw}무</b></div>`);
  if (!synced) $('demo').checked = g.demo;
}

function renderMemory(g) {
  setHTML('album', $('album'), g.album.length
    ? g.album.map(p => `<div class="photo"><img loading="lazy" src="${esc(media('/album/' + encodeURIComponent(p.file)))}" alt="${esc(p.caption)}">
        <button class="del" data-delphoto="${esc(p.file)}" title="사진 지우기">🗑️</button>
        <b>${esc(p.caption)}</b><small>${esc(p.time)}</small></div>`).join('')
    : '<div class="empty">레벨이 오르거나 개인기를 마스터하면 기념사진이 남아요 📸</div>');
  setHTML('diary', $('diary'), g.diary.length
    ? g.diary.map(d => `<li><small>${esc(d.time)}</small>${esc(d.text)}</li>`).join('')
    : '<li class="mut">아직 일기가 비어 있어요</li>');
}

function renderNotice(n) {
  if (!n) return;
  if (lastSeq === null) { lastSeq = n.seq; return; }        // don't replay old news on page load
  if (n.seq === lastSeq) return;
  lastSeq = n.seq;
  $('modalTitle').textContent = n.title;
  $('modalLines').innerHTML = n.lines.map(l => `<li>${esc(l)}</li>`).join('');
  const colors = ['#ff7a59', '#ffbe3d', '#22b3a2', '#8b6cf6', '#ff6f91'];
  $('confetti').innerHTML = Array.from({length: 60}, (_, i) =>
    `<i style="left:${Math.random() * 100}%;background:${colors[i % 5]};animation-duration:${1.6 + Math.random() * 1.6}s;animation-delay:${Math.random() * .6}s"></i>`).join('');
  $('modal').classList.remove('hide');
}

let camWasOn = null;
let camPending = 0;              // ignore server echoes for a moment after the user flips the switch
function renderCamera(cam) {
  if (Date.now() - camPending > 1500) $('camera').checked = cam.on;
  $('camera').parentElement.classList.toggle('on', cam.on);
  $('camOff').classList.toggle('hide', cam.on);
  $('video').classList.toggle('hide', !cam.on);
  if (!cam.on) $('label').textContent = '카메라 꺼짐';
  if (cam.error && camWasOn !== false) toast('📷 ' + cam.error);
  camWasOn = cam.on;
}
function setCamera(on) {
  camPending = Date.now();
  $('camera').checked = on;
  post('/camera/' + (on ? 'on' : 'off')).then(() => poll(true));
  toast(on ? '📷 카메라를 켰어요' : '📷 카메라를 껐어요');
}

// ---------- voice (web/static/voice.js, after microduck) ----------
// The robot's buzzer has one pitch; the creature voice plays on the device showing this page.
const VOICE_KEY = 'razVoiceOn';
let voiceOn = true;
try { voiceOn = localStorage.getItem(VOICE_KEY) !== '0'; } catch (e) { /* private mode */ }
let lastEventId = null;
let voiceSeed = null;
let lastActMsg = '';
const VOICE_TEST = [['hello', '👋 인사'], ['happy', '😊 기쁨'], ['love', '🥰 사랑'], ['surprised', '😮 놀람'],
  ['call', '🥺 놀아줘'], ['confused', '🤔 갸우뚱'], ['treat', '🍪 냠냠'], ['scared', '😨 무서워'], ['levelup', '🎉 신남']];
$('voiceBtns').innerHTML = VOICE_TEST.map(([k, v]) => `<button data-say="${k}">${v}</button>`).join('');
$('voiceOn').checked = voiceOn;

function updateTapHint() {
  $('tapSound').classList.toggle('hide', !voiceOn || RazVoice.ready || !conn.ok);
}
// browsers only allow sound after the user touched the page once
document.addEventListener('pointerdown', () => { RazVoice.unlock(); setTimeout(updateTapHint, 150); }, {passive: true});

function renderVoice(g, pet) {
  if (g.voice_seed !== undefined && g.voice_seed !== voiceSeed) {
    voiceSeed = g.voice_seed;
    RazVoice.setSeed(voiceSeed);
    const d = RazVoice.describe();
    $('voiceSummary').textContent = d.summary;
    $('voiceTraits').innerHTML = d.traits.map(([k, v]) => `<div>${esc(k)}<b>${esc(v)}</b></div>`).join('');
  }
  const ev = pet.events[0];
  if (ev && ev.id !== undefined && ev.id !== lastEventId) {
    if (lastEventId !== null && voiceOn) RazVoice.say(ev.sound);    // don't replay old news on page load
    lastEventId = ev.id;
  }
  const a = g.activity;                                            // rock-paper-scissors countdown
  const msg = a && a.type === 'rps' && a.phase === 'count' ? a.msg : '';
  if (msg && msg !== lastActMsg && voiceOn) RazVoice.say('tick');
  lastActMsg = msg;
  updateTapHint();
}

$('voiceOn').onchange = e => {
  voiceOn = e.target.checked;
  try { localStorage.setItem(VOICE_KEY, voiceOn ? '1' : '0'); } catch (err) { /* private mode */ }
  if (voiceOn) { RazVoice.unlock(); RazVoice.say('hello'); }
  updateTapHint();
  updateSoundBtn();
};

// ---------- sound panel: voice volume (this device) + robot buzzer mode ----------
const VOL_KEY = 'razVoiceVol';
let voiceVol = 80;
try { voiceVol = +(localStorage.getItem(VOL_KEY) ?? 80); } catch (e) { /* private mode */ }
let buzzMode = 'normal';
let buzzPending = 0;                    // ignore server echoes right after a click

function applyVolume() {
  // perceived loudness: square the slider so the low end is usable
  RazVoice.volume = Math.pow(voiceVol / 100, 2) * 1.2;
  $('voiceVol').value = voiceVol;
  $('volText').textContent = voiceVol;
  $('volIcon').textContent = voiceVol === 0 ? '🔇' : voiceVol < 50 ? '🔉' : '🔊';
}
function updateSoundBtn() {
  const voice = voiceOn && voiceVol > 0;
  const icon = !voice && buzzMode === 'off' ? '🔇' : voice && voiceVol >= 50 ? '🔊' : '🔉';
  $('soundBtn').textContent = `${icon} 소리`;
}
function renderBuzz(mode, hasRobot) {
  if (Date.now() - buzzPending > 1500 && mode) buzzMode = mode;
  document.querySelectorAll('#buzzSeg button').forEach(b => b.classList.toggle('on', b.dataset.buzz === buzzMode));
  $('buzzTest').disabled = !hasRobot || buzzMode === 'off';
  $('buzzTest').textContent = hasRobot ? '▶ 부저 시험 (삐삐)' : '라즈봇이 연결되면 시험할 수 있어요';
  updateSoundBtn();
}
$('voiceVol').oninput = e => {
  voiceVol = +e.target.value;
  try { localStorage.setItem(VOL_KEY, String(voiceVol)); } catch (err) { /* private mode */ }
  RazVoice.unlock();
  applyVolume();
  updateSoundBtn();
};
$('voiceVol').onchange = () => { if (voiceOn && voiceVol > 0) RazVoice.say('hello'); };
$('buzzSeg').onclick = e => {
  const b = e.target.closest('button[data-buzz]');
  if (!b) return;
  buzzMode = b.dataset.buzz; buzzPending = Date.now();
  post('/buzz/' + buzzMode);
  renderBuzz(buzzMode, G && G.robot);
};
$('buzzTest').onclick = () => post('/buzz/test');
$('soundBtn').onclick = e => { e.stopPropagation(); $('soundPanel').classList.toggle('hide'); };
document.addEventListener('click', e => {
  if (!$('soundPanel').classList.contains('hide') && !e.target.closest('.soundwrap')) $('soundPanel').classList.add('hide');
});
applyVolume();
updateSoundBtn();
$('voiceReroll').onclick = () => act('voice');
$('tapSound').onclick = () => { RazVoice.unlock(); setTimeout(() => { RazVoice.say('hello'); updateTapHint(); }, 100); };

// ---------- 라즈봇 card ----------
const cardOpt = {template: 'passport', season: 'none', format: 'wide', photo: 'robot'};
try { Object.assign(cardOpt, JSON.parse(localStorage.getItem('razCardOpt') || '{}')); } catch (e) { /* private mode */ }
let cardSig = '';
let cardData = null;

function renderCardOptions() {
  const row = (key, map) => Object.entries(map).map(([k, v]) =>
    `<button data-copt="${key}" data-v="${k}" class="${cardOpt[key] === k ? 'on' : ''}">${esc(v)}</button>`).join('');
  $('optTemplate').innerHTML = `<button data-copt="template" data-v="random">🎲 랜덤</button>` + row('template', RazCard.TEMPLATES);
  $('optSeason').innerHTML = row('season', RazCard.SEASONS);
  $('optFormat').innerHTML = row('format', RazCard.FORMATS);
  $('optPhoto').innerHTML = row('photo', RazCard.PHOTOS) +
    '<span class="mut" style="align-self:center">폴라로이드에 들어가요 · 얼굴이 나올 수 있어요</span>';
}

function renderCardRecord(d) {
  const s = d.stats;
  const items = [['함께한 날', `${s.days}일`], ['함께한 시간', `${s.together_h}시간`], ['깨어 있던 시간', `${s.awake_h}시간`],
    ['호감도', `${d.xp} XP · Lv${d.level}`], ['🤚 쓰담쓰담', `${s.pet}번`], ['👋 인사', `${s.hello}번`],
    ['✋ 하이파이브', `${s.high_five}번`], ['👍 칭찬', `${s.praise}번`], ['🍪 간식', `${s.treat}번`], ['🎓 훈련', `${s.train}번`],
    ['🎭 개인기 자랑', `${s.show}번`], ['✊ 가위바위보', `${s.rps.win}승 ${s.rps.lose}패 ${s.rps.draw}무`],
    ['👉 이리 와', `${s.come}번`], ['🔥 최고 연속', `${s.best_streak}일`], ['😨 놀란 횟수', `${s.scared}번`],
    ['🚗 움직인 거리', s.distance_m > 0 ? `약 ${s.distance_m}m` : '로봇 없이 놀았어요']];
  setHTML('cardStats', $('cardStats'), items.map(([k, v]) => `<div>${esc(k)}<b>${esc(v)}</b></div>`).join(''));
  const got = d.badges.filter(b => b.earned).length;
  $('badgeCount').textContent = `${got} / ${d.badges.length}`;
  setHTML('badges', $('badges'), d.badges.map(b => `<div class="badge ${b.earned ? '' : 'off'}">
    <div class="ic">${b.earned ? b.icon : '🔒'}</div><b>${esc(b.name)}</b><small>${esc(b.desc)}</small></div>`).join(''));
}

async function refreshCard(force) {
  if ($('tab-card').classList.contains('hide')) return;
  try {
    const d = await (await apiFetch('/game/card')).json();
    renderCardRecord(d);
    const sig = JSON.stringify([d, cardOpt]);
    if (!force && sig === cardSig) return;
    cardSig = sig;
    cardData = d;
    $('cardCanvas').parentElement.classList.toggle('story', cardOpt.format === 'story');
    await RazCard.draw($('cardCanvas'), d, Object.assign({media}, cardOpt));
  } catch (e) { /* robot offline */ }
}

function cardBlob() {
  return new Promise(res => $('cardCanvas').toBlob(res, 'image/png'));
}
function cardFileName() {
  return `${(cardData && cardData.name) || '라즈봇'}-카드-${cardOpt.template}.png`;
}

$('cardSave').onclick = async () => {
  const url = URL.createObjectURL(await cardBlob());
  const a = Object.assign(document.createElement('a'), {href: url, download: cardFileName()});
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast('카드를 이미지로 저장했어요 💾');
};
$('cardShare').onclick = async () => {
  const file = new File([await cardBlob()], cardFileName(), {type: 'image/png'});
  try {
    await navigator.share({files: [file], title: '나의 라즈봇 카드', text: `${cardData.name} · Lv ${cardData.level}`});
  } catch (e) { /* cancelled */ }
};
$('cardCopy').onclick = async () => {
  try {
    await navigator.clipboard.write([new ClipboardItem({'image/png': cardBlob()})]);
    toast('카드를 복사했어요. 붙여넣기 해 보세요 📋');
  } catch (e) { toast('복사하지 못했어요. 이미지 저장을 이용해 주세요'); }
};
// share / copy need a secure page (localhost or https) and browser support
try {
  const probe = new File([new Blob()], 'x.png', {type: 'image/png'});
  $('cardShare').classList.toggle('hide', !(navigator.canShare && navigator.canShare({files: [probe]})));
} catch (e) { /* no Web Share */ }
$('cardCopy').classList.toggle('hide', !(window.isSecureContext && navigator.clipboard && window.ClipboardItem));
renderCardOptions();
setInterval(refreshCard, 5000);

// ---------- loop ----------
let polling = false;
async function poll(once) {
  if (!once) polling = true;
  try {
    const r = await apiFetch('/game/state');
    if (r.status === 401) throw new Error('code');
    const s = await r.json();
    G = s;
    setConn(true);
    if (!synced) $('motion').checked = s.motion;
    renderBuzz(s.buzz, s.robot);
    renderTop(s.game); renderHero(s.game, s.pet, s); renderActivity(s.game.activity); renderVoice(s.game, s.pet);
    renderBook(s.game); renderTricks(s.game, s); renderQuests(s.game); renderMemory(s.game);
    renderNotice(s.game.notice);
    renderCamera(s.camera);
    synced = true;
  } catch (e) {
    setConn(false);                     // robot offline - keep trying
  }
  if (!once) setTimeout(poll, 400);
}

function setConn(ok) {
  conn.fails = ok ? 0 : conn.fails + 1;
  conn.ok = ok || conn.fails < 3;
  const chip = $('connChip');
  chip.classList.toggle('hide', !conn.remote);
  chip.classList.toggle('ok', conn.ok);
  chip.classList.toggle('bad', !conn.ok);
  chip.textContent = conn.ok ? '🔌 ' + conn.base.replace(/^https?:\/\//, '') : '⚠️ 연결 끊김 · 다시 연결';
}

const CONN_KEY = 'razbotConn';
function normalizeUrl(u) {
  u = (u || '').trim().replace(/\/+$/, '');
  if (u && !/^https?:\/\//i.test(u)) u = (/^(localhost|127\.|\[::1\])/.test(u) ? 'http://' : 'https://') + u;
  return u;
}
function connError(url, err) {
  const local = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(url);
  if (err === 'code') return '접속 코드가 맞지 않아요. 라즈베리파이 터널 화면에 나온 코드를 넣어 주세요.';
  if (location.protocol === 'https:' && url.startsWith('http://') && !local) {
    return '같은 와이파이의 라즈베리파이(http://…)에 연결하지 못했어요. 브라우저가 "로컬 네트워크 액세스"를 물으면 [허용]을 눌러 주세요. ' +
      '그래도 안 되면 라즈베리파이에서 ./tunnel.sh 를 실행하고 나온 https 주소와 접속 코드를 넣어 주세요.';
  }
  return local
    ? '이 PC의 라즈봇 프로그램에 연결하지 못했어요. ① play_pc.bat 이 켜져 있는지 확인하고 ' +
      '② 브라우저가 "로컬 네트워크의 기기에 액세스" 권한을 물으면 [허용]을 눌러 주세요. ' +
      '이미 차단했다면 주소창 왼쪽 자물쇠(사이트 정보) → 사이트 설정 → "로컬 네트워크 액세스"를 허용으로 바꾼 뒤 다시 연결하세요.'
    : '라즈봇에 연결하지 못했어요. 주소와 라즈봇 프로그램이 켜져 있는지 확인해 주세요.';
}

async function tryConnect(url, token) {
  url = normalizeUrl(url);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 6000);
  try {
    const headers = token ? {'X-Razbot-Token': token} : {};
    const space = addressSpace(url);
    const r = await fetch(url + '/game/state', Object.assign({headers, signal: ctl.signal, cache: 'no-store'},
      space ? {targetAddressSpace: space} : {}));
    if (r.status === 401) return connError(url, 'code');
    const j = await r.json();
    if (!j.game) throw new Error('not a razbot');
  } catch (e) {
    return connError(url);
  } finally {
    clearTimeout(timer);
  }
  Object.assign(conn, {base: url, token, remote: true});
  try { localStorage.setItem(CONN_KEY, JSON.stringify({url, token})); } catch (e) { /* private mode */ }
  return null;
}

function openConnect(msg) {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(CONN_KEY) || '{}'); } catch (e) { /* private mode */ }
  $('connUrl').value = conn.base || saved.url || 'http://localhost:5000';
  $('connToken').value = conn.token || saved.token || '';
  $('connErr').textContent = msg || '';
  $('connErr').classList.toggle('hide', !msg);
  updateOpenDirect();
  $('connect').classList.remove('hide');
}

// fallback that never needs a browser permission: open the page the robot program serves itself
function updateOpenDirect() {
  const url = normalizeUrl($('connUrl').value);
  const ok = /^https?:\/\//.test(url) && !$('connErr').classList.contains('hide');
  $('openDirect').href = url + '/game';
  $('openDirect').textContent = addressSpace(url) === 'loopback' ? '💻 이 PC의 게임 화면 바로 열기' : '🤖 라즈봇의 게임 화면 바로 열기';
  $('openDirect').classList.toggle('hide', !ok);
}
$('connUrl').addEventListener('input', updateOpenDirect);

$('connectForm').onsubmit = async e => {
  e.preventDefault();
  $('connGo').disabled = true; $('connGo').textContent = '연결 중…';
  const err = await tryConnect($('connUrl').value, $('connToken').value.trim());
  $('connGo').disabled = false; $('connGo').textContent = '연결하기';
  if (err) { $('connErr').textContent = err; $('connErr').classList.remove('hide'); updateOpenDirect(); return; }
  $('connect').classList.add('hide');
  toast('라즈봇과 연결됐어요! 🔌');
  startGame();
};
$('connChip').onclick = () => openConnect();

function startGame() {
  synced = false; cardSig = '';
  $('video').src = $('camBox').open ? media('/video') : '';
  post('/game/act/enter');
  if (!polling) poll(); else poll(true);
}

async function boot() {
  // 1) the page came from the robot itself
  try {
    const r = await fetch('/game/state', {cache: 'no-store'});
    if (r.ok && (r.headers.get('content-type') || '').includes('json')) { startGame(); return; }
  } catch (e) { /* not served by the robot */ }
  // 2) hosted page (Vercel): reconnect to the last robot, or ask for one (?robot=<address> pre-fills it)
  conn.remote = true;
  document.querySelector('.back').classList.add('hide');
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(CONN_KEY) || '{}'); } catch (e) { /* private mode */ }
  const asked = new URLSearchParams(location.search).get('robot');
  const url = asked || saved.url || 'http://localhost:5000';
  const token = asked && asked !== saved.url ? '' : (saved.token || '');
  const err = await tryConnect(url, token);
  if (err) {
    conn.fails = 2; setConn(false);     // show "연결 끊김" right away
    openConnect(saved.url || asked ? err : '');
    return;
  }
  startGame();
}

// ---------- events ----------
document.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  if (b.dataset.act) act(b.dataset.act);
  if (b.dataset.delphoto) {
    // two taps: the first arms the button, the second (within 3 s) deletes
    if (b.classList.contains('armed')) {
      act('photo_delete', {file: b.dataset.delphoto}).then(j => { if (j && j.ok) { sigs.album = null; toast('사진을 지웠어요 🗑️'); } });
    } else {
      b.classList.add('armed'); b.textContent = '정말 지울까요?';
      setTimeout(() => { b.classList.remove('armed'); b.textContent = '🗑️'; }, 3000);
    }
  }
  if (b.dataset.say) { RazVoice.unlock(); setTimeout(() => RazVoice.say(b.dataset.say), 50); }
  if (b.dataset.train) act('train', {trick: b.dataset.train});
  if (b.dataset.tab) {
    document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x === b));
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('hide', x.id !== 'tab-' + b.dataset.tab));
    if (b.dataset.tab === 'card') refreshCard(true);
  }
  if (b.dataset.copt) {
    let v = b.dataset.v;
    if (v === 'random') {
      const others = Object.keys(RazCard.TEMPLATES).filter(k => k !== cardOpt.template);
      v = others[Math.floor(Math.random() * others.length)];
    }
    cardOpt[b.dataset.copt] = v;
    try { localStorage.setItem('razCardOpt', JSON.stringify(cardOpt)); } catch (e) { /* private mode */ }
    renderCardOptions();
    refreshCard(true);
  }
  if (b.dataset.add && seq.length < 8) { seq.push(b.dataset.add); seqDirty = true; renderTricks(G.game, G); }
  if (b.dataset.del) { seq.splice(+b.dataset.del, 1); seqDirty = true; renderTricks(G.game, G); }
});
$('saveSeq').onclick = async () => {
  const j = await act('custom', {steps: seq});
  if (j && j.ok) { seqDirty = false; toast('나만의 개인기를 저장했어요! 이제 훈련해 주세요 🎬'); }
};
$('modalOk').onclick = () => $('modal').classList.add('hide');
$('camera').onchange = e => setCamera(e.target.checked);
$('camOn').onclick = () => setCamera(true);
$('motion').onchange = e => post('/motion/' + (e.target.checked ? 'on' : 'off'));
$('demo').onchange = e => act('demo', {on: e.target.checked});
$('name').onclick = () => {
  $('nameInput').value = $('name').textContent;
  $('name').classList.add('hide'); $('nameInput').classList.remove('hide'); $('nameInput').focus();
};
const saveName = () => {
  if ($('nameInput').classList.contains('hide')) return;
  act('rename', {name: $('nameInput').value});
  $('nameInput').classList.add('hide'); $('name').classList.remove('hide');
  $('name').textContent = $('nameInput').value || $('name').textContent;
};
$('nameInput').onblur = saveName;
$('nameInput').onkeydown = e => { if (e.key === 'Enter') saveName(); };
$('camBox').ontoggle = () => { $('video').src = $('camBox').open ? media('/video') : ''; };

setInterval(() => { if (conn.ok && polling) $('face').src = media('/face.png?' + Date.now()); }, 200);
boot();
