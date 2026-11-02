// 라즈봇 카드: draws the pet's lifetime record into a shareable PNG (idea from microduck's vet book cards).
// RazCard.draw(canvas, data, {template, season, format}) - data comes from /game/card.
(function () {
  const TEMPLATES = {passport: '🛂 여권', gameboy: '🎮 게임보이', polaroid: '📷 폴라로이드', receipt: '🧾 영수증', player: '⚽ 선수 카드'};
  const SEASONS = {none: '기본', halloween: '🎃 할로윈', winter: '❄️ 겨울', valentine: '💕 발렌타인'};
  const FORMATS = {wide: '가로 1200×630', story: '세로 스토리 1080×1920'};
  // the album holds real camera shots (people's faces), so a photo goes on the card only when chosen
  const PHOTOS = {robot: '🤖 로봇 그림', album: '📷 최근 앨범 사진'};
  const FACE_OK = ['neutral', 'happy', 'sleepy', 'bored', 'surprised', 'love', 'shy', 'sulky', 'scared'];
  const JUA = "'Jua', 'Malgun Gothic', sans-serif";
  const SANS = "system-ui, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif";
  const MONO = "'Consolas', 'D2Coding', 'Courier New', monospace";

  // ---------- helpers ----------
  const imgCache = {};
  function loadImg(src) {
    if (!imgCache[src]) {
      imgCache[src] = new Promise(res => {
        const im = new Image();
        im.crossOrigin = 'anonymous';           // robot on another origin: keep the canvas exportable
        im.onload = () => res(im);
        im.onerror = () => res(null);
        im.src = src;
      });
    }
    return imgCache[src];
  }

  function rng(seedText) {                       // deterministic sparkle placement per robot
    let h = 2166136261;
    for (const c of seedText) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return () => {
      h = Math.imul(h ^ (h >>> 15), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      return ((h ^= h >>> 16) >>> 0) / 4294967296;
    };
  }

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  }

  function txt(ctx, s, x, y, o = {}) {
    ctx.save();
    ctx.font = `${o.weight || ''} ${o.size || 24}px ${o.font || SANS}`;
    ctx.fillStyle = o.color || '#2d2a32';
    ctx.textAlign = o.align || 'left';
    ctx.textBaseline = o.base || 'alphabetic';
    if (o.rotate) { ctx.translate(x, y); ctx.rotate(o.rotate); x = 0; y = 0; }
    ctx.fillText(String(s), x, y, o.maxW);
    ctx.restore();
  }

  // the robot, drawn like the game page: ears, dark screen with the OLED face, wheels
  function robot(ctx, cx, cy, w, face) {
    const h = w * 0.42, x = cx - w / 2, y = cy - h / 2;
    ctx.fillStyle = '#33303a';
    for (const ex of [x + w * 0.16, x + w * 0.8]) { rr(ctx, ex, y - w * 0.06, w * 0.04, w * 0.08, 4); ctx.fill(); }
    rr(ctx, x, y, w, h, w * 0.08); ctx.fill();
    ctx.fillStyle = '#000';
    const p = w * 0.05;
    rr(ctx, x + p, y + p, w - 2 * p, h - 2 * p, w * 0.03); ctx.fill();
    if (face) {
      ctx.imageSmoothingEnabled = false;
      const fw = w - 2 * p, fh = fw / 4;
      ctx.drawImage(face, x + p, cy - fh / 2, fw, fh);
      ctx.imageSmoothingEnabled = true;
    }
    ctx.fillStyle = '#4a4553';
    for (const wx of [x + w * 0.06, x + w * 0.7]) { rr(ctx, wx, y + h - 4, w * 0.24, w * 0.07, [0, 0, 10, 10]); ctx.fill(); }
  }

  function footer(ctx, W, H, color) {
    txt(ctx, `라즈봇 카드 · ${new Date().toISOString().slice(0, 10)}`, W - 28, H - 20,
      {size: 16, color: color || 'rgba(0,0,0,.45)', align: 'right'});
  }

  const earned = d => d.badges.filter(b => b.earned);
  const trickLine = d => d.tricks.length ? d.tricks.map(t => t.icon + ' ' + t.name).join('  ') : '아직 연습 중이에요';
  const pct = (a, b) => (b ? Math.round(a / b * 100) : 0);

  // ---------- templates (1200 x 630) ----------
  function passport(ctx, d, im) {
    const W = 1200, H = 630;
    ctx.fillStyle = '#1f2a5a'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#f6f1e3'; rr(ctx, 28, 28, W - 56, H - 56, 22); ctx.fill();
    ctx.fillStyle = '#e7dfc9';
    for (let i = 0; i < 14; i++) { ctx.beginPath(); ctx.arc(700 + i * 30, 330, 160 - i * 9, 0, Math.PI * 2); ctx.globalAlpha = .08; ctx.fill(); }
    ctx.globalAlpha = 1;
    txt(ctx, '라즈봇 여권  RAZBOT PASSPORT', 60, 84, {size: 34, font: JUA, color: '#1f2a5a'});
    txt(ctx, 'REPUBLIC OF ROBOTS · 반려로봇 공화국', W - 60, 84, {size: 18, color: '#7a7466', align: 'right'});
    ctx.strokeStyle = '#1f2a5a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(60, 104); ctx.lineTo(W - 60, 104); ctx.stroke();
    // photo
    ctx.fillStyle = '#cfe3ef'; rr(ctx, 60, 130, 330, 300, 14); ctx.fill();
    robot(ctx, 225, 290, 270, im.face);
    txt(ctx, d.name, 225, 480, {size: 40, font: JUA, color: '#1f2a5a', align: 'center'});
    // fields
    const f = [['이름 / Name', d.name], ['종류 / Type', '라즈봇 V2 · 바퀴 4개'], ['레벨 / Level', `Lv ${d.level}  (호감도 ${d.xp})`],
      ['생일 / Birthday', d.born], ['함께한 날 / Days', `${d.stats.days}일째`], ['좋아하는 것 / Favorite', d.favorite || '모든 게 신기해요'],
      ['특기 / Tricks', trickLine(d)]];
    f.forEach(([k, v], i) => {
      const x = 430 + (i % 2) * 280, y = 150 + Math.floor(i / 2) * 82;
      const wide = i === f.length - 1;
      txt(ctx, k, wide ? 430 : x, y, {size: 17, color: '#8a826f'});
      txt(ctx, v, wide ? 430 : x, y + 34, {size: 28, font: JUA, color: '#2d2a32', maxW: wide ? 540 : 265});
    });
    // stamps = latest earned badges, down the right edge
    earned(d).slice(-3).forEach((b, i) => {
      ctx.save(); ctx.translate(1060 - (i % 2) * 24, 180 + i * 115); ctx.rotate((i % 2 ? 1 : -1) * 0.25);
      ctx.strokeStyle = ['#c0392b', '#1f6f8b', '#6c3483', '#1e8449'][i % 4]; ctx.lineWidth = 4; ctx.globalAlpha = .75;
      ctx.beginPath(); ctx.arc(0, 0, 50, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, 42, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
      txt(ctx, b.icon, 0, 4, {size: 34, align: 'center', base: 'middle'});
      txt(ctx, b.name, 0, 32, {size: 13, align: 'center', color: ctx.strokeStyle, font: JUA});
      ctx.restore();
    });
    // machine readable zone
    ctx.fillStyle = '#efe7d2'; ctx.fillRect(48, 520, W - 96, 80);
    const id = (d.born || '').replace(/-/g, '');
    txt(ctx, `P<RAZ<<RAZBOT<<LV${String(d.level).padStart(2, '0')}<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<`, 64, 552, {size: 24, font: MONO, color: '#3b3a36'});
    txt(ctx, `${id}<XP${String(d.xp).padStart(5, '0')}<<DAYS${String(d.stats.days).padStart(4, '0')}<<PET${String(d.stats.pet).padStart(4, '0')}<<<<<<<<<<<<<<<<`, 64, 584, {size: 24, font: MONO, color: '#3b3a36'});
  }

  function gameboy(ctx, d, im) {
    const W = 1200, H = 630;
    const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#8b6cf6'); g.addColorStop(1, '#ff7a59');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // console
    ctx.fillStyle = '#d9d6cf'; rr(ctx, 50, 30, 440, 570, [24, 24, 80, 24]); ctx.fill();
    ctx.fillStyle = '#6f6b75'; rr(ctx, 80, 60, 380, 300, [12, 12, 50, 12]); ctx.fill();
    ctx.fillStyle = '#9bbc0f'; rr(ctx, 115, 90, 310, 235, 6); ctx.fill();
    robot(ctx, 270, 200, 220, im.face);
    txt(ctx, `Lv ${d.level}`, 130, 312, {size: 24, font: JUA, color: '#0f380f'});
    txt(ctx, '♥'.repeat(Math.max(1, Math.round(d.happiness / 20))), 410, 312, {size: 24, color: '#0f380f', align: 'right'});
    txt(ctx, 'RAZBOY', 90, 395, {size: 30, font: JUA, color: '#2e2a6b'});
    txt(ctx, 'COLOR', 210, 395, {size: 20, font: JUA, color: '#c0392b'});
    ctx.fillStyle = '#2d2a32';                                          // d-pad
    rr(ctx, 105, 455, 90, 30, 4); ctx.fill(); rr(ctx, 135, 425, 30, 90, 4); ctx.fill();
    ctx.fillStyle = '#9b1b4f';                                          // A / B
    ctx.beginPath(); ctx.arc(390, 450, 26, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(330, 480, 26, 0, 7); ctx.fill();
    txt(ctx, 'A', 390, 458, {size: 20, font: JUA, color: '#fff', align: 'center'});
    txt(ctx, 'B', 330, 488, {size: 20, font: JUA, color: '#fff', align: 'center'});
    ctx.fillStyle = '#8f8a95'; rr(ctx, 200, 545, 50, 12, 6); ctx.fill(); rr(ctx, 270, 545, 50, 12, 6); ctx.fill();
    // status screen
    ctx.fillStyle = 'rgba(20,16,30,.82)'; rr(ctx, 530, 30, 620, 570, 24); ctx.fill();
    txt(ctx, `${d.name}의 스테이터스`, 570, 90, {size: 40, font: JUA, color: '#fff'});
    const bar = (label, v, y, col) => {
      txt(ctx, label, 570, y, {size: 22, font: JUA, color: '#fff'});
      ctx.fillStyle = 'rgba(255,255,255,.15)'; rr(ctx, 690, y - 20, 300, 18, 9); ctx.fill();
      ctx.fillStyle = col; rr(ctx, 690, y - 20, 3 * v, 18, 9); ctx.fill();
      txt(ctx, v, 1010, y, {size: 22, font: JUA, color: '#fff'});
    };
    bar('❤️ 행복', d.happiness, 140, '#ff6f91');
    bar('⚡ 에너지', d.energy, 180, '#ffbe3d');
    const s = d.stats;
    const rows = [['⏱️ 함께한 시간', `${s.together_h}시간`], ['📅 함께한 날', `${s.days}일`], ['🤚 쓰담쓰담', `${s.pet}번`],
      ['👋 인사', `${s.hello}번`], ['✋ 하이파이브', `${s.high_five}번`], ['🍪 간식', `${s.treat}번`],
      ['🎓 훈련', `${s.train}번`], ['✊ 가위바위보', `${s.rps.win}승 ${s.rps.lose}패 ${s.rps.draw}무`]];
    if (s.distance_m > 0) rows[7] = ['🚗 움직인 거리', `약 ${s.distance_m}m`];
    rows.forEach(([k, v], i) => {
      const x = 570 + (i % 2) * 290, y = 245 + Math.floor(i / 2) * 62;
      txt(ctx, k, x, y, {size: 18, color: '#b9b2c4'});
      txt(ctx, v, x, y + 30, {size: 28, font: JUA, color: '#fff'});
    });
    txt(ctx, '🏆 ' + trickLine(d), 570, 560, {size: 22, font: JUA, color: '#ffe082', maxW: 560});
    footer(ctx, W, H, 'rgba(255,255,255,.55)');
  }

  function polaroid(ctx, d, im) {
    const W = 1200, H = 630;
    ctx.fillStyle = '#c99d6a'; ctx.fillRect(0, 0, W, H);
    const r = rng(d.name + 'cork');
    for (let i = 0; i < 900; i++) { ctx.fillStyle = `rgba(80,50,20,${r() * .18})`; ctx.fillRect(r() * W, r() * H, 3, 3); }
    // the photo
    ctx.save(); ctx.translate(330, 320); ctx.rotate(-0.06);
    ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 8;
    ctx.fillStyle = '#fffdf8'; ctx.fillRect(-250, -280, 500, 560); ctx.shadowColor = 'transparent';
    if (im.photo) {
      const s = Math.max(460 / im.photo.width, 400 / im.photo.height);
      ctx.save(); ctx.beginPath(); ctx.rect(-230, -260, 460, 400); ctx.clip();
      ctx.drawImage(im.photo, -im.photo.width * s / 2, -60 - im.photo.height * s / 2, im.photo.width * s, im.photo.height * s);
      ctx.restore();
      robot(ctx, 140, 90, 150, im.face);                        // a little robot sticker on the photo
    } else {
      const g = ctx.createLinearGradient(0, -260, 0, 140); g.addColorStop(0, '#ffd3c4'); g.addColorStop(1, '#ffe9b0');
      ctx.fillStyle = g; ctx.fillRect(-230, -260, 460, 400);
      robot(ctx, 0, -50, 330, im.face);
    }
    txt(ctx, `${d.name} · Lv ${d.level}`, 0, 205, {size: 44, font: JUA, color: '#2d2a32', align: 'center'});
    txt(ctx, `함께한 지 ${d.stats.days}일째 💕`, 0, 248, {size: 26, font: JUA, color: '#8a8291', align: 'center'});
    ctx.restore();
    // tape
    ctx.fillStyle = 'rgba(255,255,230,.65)';
    ctx.save(); ctx.translate(330, 40); ctx.rotate(0.05); ctx.fillRect(-70, -18, 140, 36); ctx.restore();
    // sticky notes with stats
    const notes = [[`🤚 쓰담쓰담 ${d.stats.pet}번`, `👋 인사 ${d.stats.hello}번`], [`⏱️ ${d.stats.together_h}시간 함께`, `🍪 간식 ${d.stats.treat}번`],
      ['🏆 특기', trickLine(d)]];
    const colors = ['#fff176', '#a5f3e4', '#ffc4d6'];
    notes.forEach((lines, i) => {
      ctx.save(); ctx.translate(665 + i * 178, 150 + (i % 2) * 40); ctx.rotate((i - 1) * 0.07);
      ctx.shadowColor = 'rgba(0,0,0,.25)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 4;
      ctx.fillStyle = colors[i]; ctx.fillRect(0, 0, 165, 165); ctx.shadowColor = 'transparent';
      txt(ctx, lines[0], 12, 50, {size: 21, font: JUA, maxW: 141});
      txt(ctx, lines[1], 12, 100, {size: i === 2 ? 18 : 21, font: JUA, maxW: 141});
      ctx.restore();
    });
    // badge stickers
    earned(d).slice(0, 6).forEach((b, i) => {
      const x = 720 + (i % 3) * 150, y = 460 + Math.floor(i / 3) * 105;
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 42, 0, 7); ctx.fill();
      txt(ctx, b.icon, x, y + 2, {size: 40, align: 'center', base: 'middle'});
      txt(ctx, b.name, x, y + 64, {size: 18, font: JUA, align: 'center', color: '#3e2a12'});
    });
    footer(ctx, W, H, 'rgba(60,35,10,.6)');
  }

  function receipt(ctx, d, im) {
    const W = 1200, H = 630;
    ctx.fillStyle = '#e9e4da'; ctx.fillRect(0, 0, W, H);
    robot(ctx, 200, 250, 260, im.face);
    txt(ctx, `${d.name}`, 200, 400, {size: 46, font: JUA, align: 'center'});
    txt(ctx, `Lv ${d.level} · 함께한 지 ${d.stats.days}일`, 200, 440, {size: 24, font: JUA, align: 'center', color: '#8a8291'});
    // paper with zigzag edges
    const x0 = 420, x1 = 840, y0 = 18, y1 = 612;
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.2)'; ctx.shadowBlur = 14;
    ctx.fillStyle = '#fffefa'; ctx.beginPath(); ctx.moveTo(x0, y0);
    for (let x = x0; x < x1; x += 14) { ctx.lineTo(x + 7, y0 + 8); ctx.lineTo(x + 14, y0); }
    ctx.lineTo(x1, y1);
    for (let x = x1; x > x0; x -= 14) { ctx.lineTo(x - 7, y1 - 8); ctx.lineTo(x - 14, y1); }
    ctx.closePath(); ctx.fill(); ctx.restore();
    const L = x0 + 30, R = x1 - 30, line = y => { ctx.setLineDash([6, 6]); ctx.strokeStyle = '#999'; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(R, y); ctx.stroke(); ctx.setLineDash([]); };
    txt(ctx, '라즈봇 마트', (x0 + x1) / 2, 64, {size: 34, font: JUA, align: 'center'});
    txt(ctx, `RAZBOT MART · ${new Date().toLocaleString('ko-KR')}`, (x0 + x1) / 2, 92, {size: 15, font: MONO, align: 'center', color: '#666'});
    line(108);
    const s = d.stats;
    const items = [['쓰담쓰담', s.pet, '💕'], ['인사', s.hello, '👋'], ['하이파이브', s.high_five, '✋'], ['간식', s.treat, '🍪'],
      ['칭찬', s.praise, '👍'], ['훈련', s.train, '🎓'], ['개인기 자랑', s.show, '🎭'], ['가위바위보', s.rps_games, '✊'],
      ['함께한 시간(h)', s.together_h, '⏱️']];
    items.forEach(([k, v, e], i) => {
      const y = 140 + i * 34;
      txt(ctx, `${e} ${k}`, L, y, {size: 19, font: MONO});
      txt(ctx, `x ${v}`, R, y, {size: 19, font: MONO, align: 'right'});
    });
    line(450);
    txt(ctx, 'TOTAL 호감도', L, 486, {size: 24, font: JUA});
    txt(ctx, `${d.xp} XP`, R, 486, {size: 28, font: JUA, align: 'right'});
    txt(ctx, `LEVEL ${d.level} / ${d.max_level}`, L, 516, {size: 18, font: MONO, color: '#666'});
    const r = rng(d.name + d.xp);                          // barcode
    for (let x = L; x < R;) { const w = 1 + Math.floor(r() * 4); if (r() > .35) { ctx.fillStyle = '#222'; ctx.fillRect(x, 532, w, 40); } x += w + 1; }
    txt(ctx, '감사합니다! 또 놀러 오세요 ♥', (x0 + x1) / 2, 596, {size: 16, font: JUA, align: 'center', color: '#666'});
    // badges on the right
    txt(ctx, '받은 배지', 1020, 70, {size: 30, font: JUA, align: 'center'});
    const eb = earned(d).slice(0, 8);
    eb.forEach((b, i) => {
      const x = 950 + (i % 2) * 140, y = 130 + Math.floor(i / 2) * 115;
      txt(ctx, b.icon, x, y + 20, {size: 50, align: 'center'});
      txt(ctx, b.name, x, y + 56, {size: 18, font: JUA, align: 'center', color: '#5a5363'});
    });
    footer(ctx, W, H);
  }

  function player(ctx, d, im) {
    const W = 1200, H = 630;
    const bg = ctx.createRadialGradient(400, 320, 50, 600, 320, 800); bg.addColorStop(0, '#2b3d6b'); bg.addColorStop(1, '#0d1326');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    const s = d.stats, mastered = d.tricks.length;
    const rate = Math.min(99, 45 + d.level * 5 + mastered * 2);
    // gold card (shield shape)
    const cx = 330, top = 25, cw = 420, ch = 580;
    const gold = ctx.createLinearGradient(cx - cw / 2, top, cx + cw / 2, top + ch);
    gold.addColorStop(0, '#f9e29c'); gold.addColorStop(.5, '#e2b74d'); gold.addColorStop(1, '#b8862b');
    ctx.fillStyle = gold; ctx.beginPath();
    ctx.moveTo(cx - cw / 2 + 40, top); ctx.lineTo(cx + cw / 2 - 40, top); ctx.quadraticCurveTo(cx + cw / 2, top, cx + cw / 2, top + 50);
    ctx.lineTo(cx + cw / 2, top + ch - 90); ctx.quadraticCurveTo(cx + cw / 2, top + ch - 40, cx, top + ch);
    ctx.quadraticCurveTo(cx - cw / 2, top + ch - 40, cx - cw / 2, top + ch - 90); ctx.lineTo(cx - cw / 2, top + 50);
    ctx.quadraticCurveTo(cx - cw / 2, top, cx - cw / 2 + 40, top); ctx.fill();
    const ink = '#3d2a05';
    txt(ctx, rate, cx - 140, top + 110, {size: 88, font: JUA, color: ink, align: 'center'});
    txt(ctx, 'PET', cx - 140, top + 150, {size: 30, font: JUA, color: ink, align: 'center'});
    txt(ctx, '🤖', cx - 140, top + 205, {size: 40, align: 'center'});
    robot(ctx, cx + 50, top + 175, 230, im.face);
    ctx.fillStyle = 'rgba(61,42,5,.15)'; ctx.fillRect(cx - 170, top + 300, 340, 4);
    txt(ctx, d.name, cx, top + 355, {size: 46, font: JUA, color: ink, align: 'center'});
    const st = [['HAP', d.happiness], ['ENG', d.energy], ['PET', Math.min(99, s.pet)],
      ['TRK', Math.min(99, mastered * 25 + Math.min(24, s.train))], ['RPS', s.rps_games ? pct(s.rps.win, s.rps_games) : 50],
      ['BND', Math.min(99, d.level * 10)]];
    st.forEach(([k, v], i) => {
      const x = cx - 130 + (i % 2) * 150, y = top + 410 + Math.floor(i / 2) * 44;
      txt(ctx, v, x, y, {size: 34, font: JUA, color: ink});
      txt(ctx, k, x + 56, y, {size: 26, font: JUA, color: ink});
    });
    // right side
    txt(ctx, '라즈봇 FC', 600, 110, {size: 70, font: JUA, color: '#f9e29c'});
    txt(ctx, `SEASON ${new Date().getFullYear()} · Lv ${d.level} · 호감도 ${d.xp}`, 600, 155, {size: 24, font: JUA, color: '#c8d2ee'});
    txt(ctx, `함께한 지 ${s.days}일  ·  ${s.together_h}시간  ·  가위바위보 ${s.rps.win}승`, 600, 200, {size: 22, color: '#c8d2ee'});
    txt(ctx, '🏆 ' + trickLine(d), 600, 250, {size: 24, font: JUA, color: '#fff', maxW: 560});
    earned(d).slice(0, 8).forEach((b, i) => {
      const x = 600 + (i % 2) * 280, y = 300 + Math.floor(i / 2) * 70;
      ctx.fillStyle = 'rgba(255,255,255,.08)'; rr(ctx, x, y, 265, 56, 14); ctx.fill();
      txt(ctx, b.icon, x + 30, y + 38, {size: 30, align: 'center'});
      txt(ctx, b.name, x + 60, y + 36, {size: 24, font: JUA, color: '#fff', maxW: 195});
    });
    footer(ctx, W, H, 'rgba(255,255,255,.5)');
  }

  const DRAW = {passport, gameboy, polaroid, receipt, player};

  // ---------- seasonal skins ----------
  function season(ctx, W, H, kind, seedText) {
    if (kind === 'none' || !kind) return;
    const conf = {
      halloween: {icons: ['🎃', '🦇', '👻', '🕸️'], frame: '#ff7a1a', label: 'Happy Halloween'},
      winter: {icons: ['❄️', '⛄', '❄️', '🎄'], frame: '#9fd3ff', label: 'Happy Winter'},
      valentine: {icons: ['💕', '💗', '💘', '🌹'], frame: '#ff6f91', label: 'Happy Valentine'},
    }[kind];
    ctx.save();
    ctx.lineWidth = 14; ctx.strokeStyle = conf.frame; ctx.globalAlpha = .9;
    rr(ctx, 7, 7, W - 14, H - 14, 22); ctx.stroke();
    ctx.globalAlpha = 1;
    if (kind === 'winter') {                                       // snow
      const r = rng(seedText + 'snow');
      ctx.fillStyle = 'rgba(255,255,255,.8)';
      for (let i = 0; i < 140; i++) { ctx.beginPath(); ctx.arc(r() * W, r() * H, 1 + r() * 3, 0, 7); ctx.fill(); }
    }
    const r = rng(seedText + kind);
    for (let i = 0; i < 14; i++) {                                 // decorations along the edges only
      const edge = i % 4, t = r();
      const x = edge === 0 ? 30 + r() * 40 : edge === 1 ? W - 30 - r() * 40 : t * W;
      const y = edge === 2 ? 30 + r() * 30 : edge === 3 ? H - 30 - r() * 30 : t * H;
      txt(ctx, conf.icons[i % conf.icons.length], x, y, {size: 30 + r() * 22, align: 'center', base: 'middle', rotate: (r() - .5) * .8});
    }
    ctx.fillStyle = conf.frame; rr(ctx, W / 2 - 130, H - 44, 260, 34, 17); ctx.fill();
    txt(ctx, conf.label, W / 2, H - 20, {size: 20, font: JUA, color: '#fff', align: 'center'});
    ctx.restore();
  }

  // ---------- story (1080 x 1920) wraps the wide card ----------
  function story(ctx, wide, d, seasonKind) {
    const W = 1080, H = 1920;
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#fff1e6'); g.addColorStop(1, '#ffd9cc');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    txt(ctx, '🤖 나의 라즈봇', W / 2, 220, {size: 96, font: JUA, align: 'center'});
    txt(ctx, `${d.name} · Lv ${d.level} · 함께한 지 ${d.stats.days}일`, W / 2, 300, {size: 44, font: JUA, align: 'center', color: '#8a6f66'});
    ctx.save(); ctx.translate(W / 2, 700); ctx.rotate(-0.03);
    ctx.shadowColor = 'rgba(0,0,0,.3)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 16;
    ctx.drawImage(wide, -500, -262, 1000, 525); ctx.restore();
    txt(ctx, '받은 배지', W / 2, 1110, {size: 52, font: JUA, align: 'center'});
    const eb = earned(d).slice(0, 9);
    eb.forEach((b, i) => {
      const inRow = Math.min(3, eb.length - Math.floor(i / 3) * 3);       // centre short rows
      const x = W / 2 + ((i % 3) - (inRow - 1) / 2) * 320, y = 1200 + Math.floor(i / 3) * 210;
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y + 50, 70, 0, 7); ctx.fill();
      txt(ctx, b.icon, x, y + 54, {size: 70, align: 'center', base: 'middle'});
      txt(ctx, b.name, x, y + 160, {size: 34, font: JUA, align: 'center', color: '#5a5363'});
    });
    txt(ctx, `❤️ 행복 ${d.happiness}  ·  ⏱️ ${d.stats.together_h}시간  ·  🤚 ${d.stats.pet}번`, W / 2, 1830, {size: 36, font: JUA, align: 'center', color: '#8a6f66'});
    season(ctx, W, H, seasonKind, d.name);
  }

  // ---------- public ----------
  async function draw(canvas, d, opt) {
    const tpl = DRAW[opt.template] ? opt.template : 'passport';
    await document.fonts.load(`40px Jua`).catch(() => {});
    const expr = FACE_OK.includes(d.mood) && !['bored', 'sleepy'].includes(d.mood) ? d.mood : 'happy';
    const media = opt.media || (p => p);
    const [face, photo] = await Promise.all([
      loadImg(media(`/face.png?expr=${expr}&color=7fe9ff`)),
      d.photo && opt.photo === 'album' ? loadImg(media('/album/' + encodeURIComponent(d.photo))) : Promise.resolve(null),
    ]);
    const wide = opt.format === 'story' ? document.createElement('canvas') : canvas;
    wide.width = 1200; wide.height = 630;
    const wctx = wide.getContext('2d');
    DRAW[tpl](wctx, d, {face, photo});
    if (opt.format === 'story') {
      canvas.width = 1080; canvas.height = 1920;
      story(canvas.getContext('2d'), wide, d, opt.season);
    } else {
      season(wctx, 1200, 630, opt.season, d.name);
    }
    return canvas;
  }

  window.RazCard = {TEMPLATES, SEASONS, FORMATS, PHOTOS, draw};
})();
