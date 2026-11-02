"""Raise Razbot like a pet: bond (XP) -> levels -> more ways to interact, plus trick training.

- Time spent together, greetings, petting, treats, games and training earn XP.
- Each level unlocks new interactions (UNLOCKS) and tricks (TRICKS); locked gestures get a puzzled look.
- Happiness drops when the robot is ignored or threatened, energy drops with activity and comes back with sleep.
- Tricks are trained like a real pet: show the cue sign, the robot tries (it gets better with practice),
  then reward it with a thumbs-up or correct it with an open palm. Mastered tricks answer the cue anytime.
- Daily quests, a streak counter, a diary and a photo album of level-ups and mastered tricks.
State is saved to petgame.json; photos go to album/.
"""
import json
import random
import threading
import time
from collections import Counter, deque
from datetime import date, datetime, timedelta
from pathlib import Path

SAVE_FILE = Path(__file__).with_name("petgame.json")
ALBUM_DIR = Path(__file__).with_name("album")

LEVEL_XP = [0, 30, 80, 150, 240, 350, 480, 640, 830, 1050]     # total XP needed for Lv1..Lv10
MAX_LEVEL = len(LEVEL_XP)

# kind: gesture = camera, button = web page, passive = robot does it by itself, training = trick tab
UNLOCKS = [
    {"id": "hello", "level": 1, "icon": "👋", "name": "인사", "how": "손을 빠르게 좌우로 흔들기", "kind": "gesture"},
    {"id": "pet", "level": 1, "icon": "🤚", "name": "쓰담쓰담", "how": "손을 천천히 크게 좌우로", "kind": "gesture"},
    {"id": "treat", "level": 1, "icon": "🍪", "name": "간식 주기", "how": "버튼 · 하루 3번", "kind": "button"},
    {"id": "sleep", "level": 1, "icon": "💤", "name": "재우기 / 깨우기", "how": "버튼 · 에너지 회복", "kind": "button"},
    {"id": "high_five", "level": 2, "icon": "✋", "name": "하이파이브", "how": "손바닥 펴고 가만히", "kind": "gesture"},
    {"id": "praise", "level": 3, "icon": "👍", "name": "칭찬", "how": "엄지 척 (훈련 보상)", "kind": "gesture"},
    {"id": "train", "level": 3, "icon": "🎓", "name": "개인기 훈련", "how": "훈련 탭에서 시작", "kind": "training"},
    {"id": "rps", "level": 5, "icon": "✊", "name": "가위바위보", "how": "버튼 → 구호에 맞춰 손 내기", "kind": "button"},
    {"id": "call", "level": 6, "icon": "🥺", "name": "먼저 놀자고 조르기", "how": "안 놀아 주면 스스로 다가와요", "kind": "passive"},
    {"id": "come", "level": 7, "icon": "👉", "name": "이리 와", "how": "버튼 → 손을 보여 주면 따라와요", "kind": "button"},
    {"id": "aegyo", "level": 9, "icon": "🥰", "name": "애교 부리기", "how": "행복도가 높으면 가끔 스스로", "kind": "passive"},
    {"id": "custom", "level": 10, "icon": "🎬", "name": "나만의 개인기", "how": "동작을 직접 조합해 훈련", "kind": "training"},
]
UNLOCK_BY_ID = {u["id"]: u for u in UNLOCKS}

TRICKS = {
    "spin": {"name": "빙글빙글", "icon": "🌀", "level": 3, "cue": "one", "cue_icon": "☝️", "cue_text": "검지 하나",
             "move": "spin", "face": "happy", "sound": "trick"},
    "bow": {"name": "꾸벅 인사", "icon": "🙇", "level": 4, "cue": "scissors", "cue_icon": "✌️", "cue_text": "브이",
            "move": "bow", "face": "shy", "sound": "hello"},
    "dance": {"name": "댄스", "icon": "💃", "level": 6, "cue": "horns", "cue_icon": "🤘", "cue_text": "검지+새끼",
              "move": "dance", "face": "happy", "sound": "win"},
    "play_dead": {"name": "죽은 척", "icon": "💀", "level": 8, "cue": "three", "cue_icon": "🤟", "cue_text": "세 손가락",
                  "move": "play_dead", "face": "dead", "sound": "dead"},
    "custom": {"name": "나만의 개인기", "icon": "🎬", "level": 10, "cue": "rock", "cue_icon": "✊", "cue_text": "주먹 (가만히)",
               "move": None, "face": "love", "sound": "trick"},
}
CUE_TO_TRICK = {t["cue"]: tid for tid, t in TRICKS.items()}
CUE_FRAMES = 6

# daily quest pool: (id, text, counter key, target, xp, min level)
QUESTS = [
    ("q_hello", "인사하기", "hello", 1, 10, 1),
    ("q_pet", "쓰담쓰담 3번", "pet", 3, 15, 1),
    ("q_treat", "간식 주기", "treat", 1, 10, 1),
    ("q_together", "함께 10분 보내기", "together", 10, 20, 1),
    ("q_high_five", "하이파이브 2번", "high_five", 2, 15, 2),
    ("q_praise", "칭찬 2번", "praise", 2, 10, 3),
    ("q_train", "훈련 3번", "train", 3, 20, 3),
    ("q_rps", "가위바위보 3판", "rps", 3, 15, 5),
    ("q_show", "개인기 보여주기 2번", "show", 2, 15, 4),
    ("q_come", "이리 와 성공", "come", 1, 15, 7),
]

EVENT_KEY = {"hello": "hello", "morning": "hello", "night": "hello", "pet": "pet", "high_five": "high_five",
             "praise": "praise"}
XP_FOR = {"hello": 3, "pet": 4, "high_five": 3, "praise": 2}
HAPPY_FOR = {"hello": 5, "pet": 8, "high_five": 5, "praise": 4}
DAILY_XP_CAP = 20            # per interaction type
TOGETHER_XP_CAP = 60         # per day, 1 XP per minute together
FOLLOW_SIGN = 1              # flip to -1 if "이리 와" turns the wrong way on your robot


def _today():
    return date.today().isoformat()


class PetGame:
    def __init__(self, companion, robot, face, motion_on, frame_jpg, active):
        self.c = companion
        self.robot = robot
        self.face = face
        self.motion_on = motion_on
        self.frame_jpg = frame_jpg          # -> latest camera JPEG bytes or None
        self.active = active                # -> True while the game page / companion mode is on
        self._lock = threading.RLock()
        self.s = self._load()
        self.activity = None                # current mini activity (training / rps / come)
        self._cancel = threading.Event()
        self._reward = None
        self._labels = deque(maxlen=90)     # (t, label) recent camera labels
        self._streak_label, self._streak = None, 0
        self._hand = None                   # (t, x, size) of the last seen hand
        self._last_present = 0.0
        self._last_interaction = time.time()
        self._last_hint = 0.0
        self._recent_xp = {}                # event key -> last time, for diminishing returns
        self.notice = None                  # latest level-up / mastery / quest notice for the page
        self._dirty = True
        self._new_day()

        companion.gate = self.gate
        companion.on_event = self.on_event
        companion.level = lambda: self.level
        companion.need_mood = self.need_mood
        companion.suspended = lambda: self.activity is not None
        threading.Thread(target=self._tick, daemon=True).start()

    # ---------- persistence ----------
    def _defaults(self):
        return {"name": "라즈봇", "xp": 0, "happiness": 70, "energy": 100, "tricks": {}, "custom_steps": [],
                "day": None, "quests": [], "counters": {}, "xp_today": {}, "treats_today": 0, "streak": 0,
                "last_complete_day": None, "album": [], "diary": [], "together_sec": 0,
                "rps": {"win": 0, "lose": 0, "draw": 0}, "born": _today(), "demo": False, "last_save": time.time(),
                # lifetime record for the 라즈봇 card (vet book)
                "totals": {}, "best_streak": 0, "awake_sec": 0, "distance_m": 0.0, "mastered_on": {},
                # one seed = one voice (web/static/voice.js, after microduck): the same robot always sounds the same
                "voice_seed": random.getrandbits(32)}

    def _load(self):
        s = self._defaults()
        try:
            s.update(json.loads(SAVE_FILE.read_text(encoding="utf-8")))
        except (OSError, ValueError):
            return s
        if not s["totals"] and s["day"] == _today():
            s["totals"] = dict(s["counters"])     # saves from before the card existed: start from today's record
        hours = max(0.0, (time.time() - s["last_save"]) / 3600)
        s["happiness"] = max(10, s["happiness"] - min(30, int(hours * 3)))     # missed you while away
        s["energy"] = min(100, s["energy"] + int(hours * 20))                   # rested while away
        return s

    def _save(self):
        with self._lock:
            self.s["last_save"] = time.time()
            data = json.dumps(self.s, ensure_ascii=False, indent=1)
        try:
            SAVE_FILE.write_text(data, encoding="utf-8")
            self._dirty = False
        except OSError:
            pass

    # ---------- derived ----------
    @property
    def level(self):
        xp = self.s["xp"]
        return max(i + 1 for i, need in enumerate(LEVEL_XP) if xp >= need)

    def unlocked(self, feature_id):
        u = UNLOCK_BY_ID.get(feature_id) or TRICKS.get(feature_id)
        return u is None or self.level >= u["level"]

    def gate(self, feature_id):
        """Companion hook: None if the interaction is unlocked, else a 'not yet' message."""
        if self.unlocked(feature_id):
            return None
        u = UNLOCK_BY_ID.get(feature_id) or TRICKS[feature_id]
        return f"'{u['name']}'은(는) 아직 몰라요… Lv{u['level']}에 배워요 🤔"

    def need_mood(self):
        if self.s["energy"] < 15:
            return "sleepy"
        if self.s["happiness"] < 25:
            return "bored"
        return None

    def mastered(self, tid):
        return self.s["tricks"].get(tid, 0) >= 100

    # ---------- bookkeeping ----------
    def _diary(self, text):
        with self._lock:
            self.s["diary"].insert(0, {"time": datetime.now().strftime("%m/%d %H:%M"), "text": text})
            del self.s["diary"][60:]
        self._dirty = True

    def _change(self, happiness=0, energy=0):
        with self._lock:
            self.s["happiness"] = max(0, min(100, self.s["happiness"] + happiness))
            self.s["energy"] = max(0, min(100, self.s["energy"] + energy))
        self._dirty = True

    def add_xp(self, n, reason=""):
        with self._lock:
            if n > 0 and self.s["demo"]:
                n *= 5
            before = self.level
            floor = LEVEL_XP[before - 1]                 # bond can dip but levels are never lost
            self.s["xp"] = max(floor, self.s["xp"] + n)
            after = self.level
        self._dirty = True
        for lv in range(before + 1, after + 1):
            self._level_up(lv)

    def _count(self, key, n=1):
        with self._lock:
            self.s["counters"][key] = self.s["counters"].get(key, 0) + n
            self.s["totals"][key] = self.s["totals"].get(key, 0) + n
        self._check_quests()

    def _new_day(self):
        today = _today()
        with self._lock:
            if self.s["day"] == today:
                return
            self.s["day"] = today
            self.s["counters"], self.s["xp_today"], self.s["treats_today"] = {}, {}, 0
            pool = [q for q in QUESTS if q[5] <= self.level]
            self.s["quests"] = [{"id": q[0], "text": q[1], "key": q[2], "target": q[3], "xp": q[4], "done": False}
                                for q in random.sample(pool, min(3, len(pool)))]
        self._dirty = True

    def _check_quests(self):
        rewards = []
        with self._lock:
            for q in self.s["quests"]:
                if not q["done"] and self.s["counters"].get(q["key"], 0) >= q["target"]:
                    q["done"] = True
                    rewards.append(q)
            all_done = rewards and all(q["done"] for q in self.s["quests"])
        for q in rewards:
            self._diary(f"오늘의 할 일 완료: {q['text']} (+{q['xp']} XP)")
            self.add_xp(q["xp"])
        if all_done:
            today, yesterday = date.today(), (date.today() - timedelta(days=1)).isoformat()
            with self._lock:
                last = self.s["last_complete_day"]
                self.s["streak"] = self.s["streak"] + 1 if last == yesterday else (self.s["streak"] if last == today.isoformat() else 1)
                self.s["last_complete_day"] = today.isoformat()
                streak = self.s["streak"]
                self.s["best_streak"] = max(self.s["best_streak"], streak)
            bonus = 10 * min(streak, 5)
            self._diary(f"오늘의 할 일 모두 완료! 🔥 {streak}일 연속 (+{bonus} XP)")
            self._notify("quest", "오늘의 할 일 완료! 🎉", [f"🔥 {streak}일 연속", f"보너스 +{bonus} XP"])
            self.add_xp(bonus)

    def _notify(self, kind, title, lines):
        seq = (self.notice or {}).get("seq", 0) + 1
        self.notice = {"seq": seq, "kind": kind, "title": title, "lines": lines}

    def _photo(self, caption):
        jpg = self.frame_jpg()
        if not jpg:
            return
        ALBUM_DIR.mkdir(exist_ok=True)
        name = f"{int(time.time() * 1000)}.jpg"
        try:
            (ALBUM_DIR / name).write_bytes(jpg)
        except OSError:
            return
        with self._lock:
            self.s["album"].insert(0, {"file": name, "caption": caption, "time": datetime.now().strftime("%Y-%m-%d %H:%M")})
            del self.s["album"][40:]
        self._dirty = True

    def _when_free(self, *perform_args, timeout=6.0):
        """Run companion.perform as soon as the robot is free (reactions may still be playing)."""
        def run():
            end = time.time() + timeout
            while self.c.busy and time.time() < end:
                time.sleep(0.1)
            self.c.perform(*perform_args)
        threading.Thread(target=run, daemon=True).start()

    def _level_up(self, lv):
        new = [f"{u['icon']} {u['name']}" for u in UNLOCKS if u["level"] == lv]
        new += [f"{t['icon']} 개인기 '{t['name']}' 훈련 가능" for t in TRICKS.values() if t["level"] == lv]
        self._diary(f"레벨 {lv} 달성! " + (", ".join(new) if new else ""))
        self._notify("levelup", f"레벨 {lv} 달성! 🎉", new or ["더 친해졌어요"])
        self._photo(f"레벨 {lv} 달성 기념")
        self._change(happiness=10)
        self.c.glow("happy", 40)
        self._when_free(f"text:Lv{lv}", 3, "levelup", "happy_dance", f"레벨 {lv}! 더 친해졌어요 🎉", "levelup")
        with self._lock:                       # a young pet may have had fewer than 3 quests today
            have = {q["id"] for q in self.s["quests"]}
            pool = [q for q in QUESTS if q[5] <= lv and q[0] not in have]
            if len(self.s["quests"]) < 3 and pool:
                q = random.choice(pool)
                self.s["quests"].append({"id": q[0], "text": q[1], "key": q[2], "target": q[3], "xp": q[4], "done": False})

    # ---------- inputs ----------
    def on_event(self, event):
        """Companion hook: a reaction actually played."""
        self._last_interaction = time.time()
        if event == "scared":
            with self._lock:
                self.s["totals"]["scared"] = self.s["totals"].get("scared", 0) + 1
            self._change(happiness=-15)
            self.add_xp(-3)
            self._diary("주먹에 깜짝 놀랐어요… 😨")
            return
        key = EVENT_KEY.get(event)
        if not key:
            return
        if event == "night":
            self.c.set_sleeping(True)
        self._count(key)
        now = time.time()
        with self._lock:
            done_today = self.s["xp_today"].get(key, 0)
            self.s["xp_today"][key] = done_today + 1
        xp = XP_FOR[key] if done_today < DAILY_XP_CAP else 0
        if now - self._recent_xp.get(key, 0) < 45:
            xp = max(1, xp // 2) if xp else 0             # same thing again right away counts less
        self._recent_xp[key] = now
        self._change(happiness=HAPPY_FOR[key], energy=-1)
        self.add_xp(xp)

    def update(self, label, lm):
        """Per camera frame (companion mode)."""
        now = time.time()
        self._labels.append((now, label))
        if label == self._streak_label:
            self._streak += 1
        else:
            self._streak_label, self._streak = label, 1
        if label is None:
            return
        self._last_present = now
        size = ((lm[0].x - lm[9].x) ** 2 + (lm[0].y - lm[9].y) ** 2) ** 0.5
        self._hand = (now, lm[9].x, size)

        # mastered tricks answer their cue sign anytime
        if (self.activity is None and label in CUE_TO_TRICK and self._streak == CUE_FRAMES
                and not self.c.busy and not self.c.sleeping):
            tid = CUE_TO_TRICK[label]
            if self.mastered(tid) and self.unlocked(tid):
                self._show_trick(tid)
            elif self.unlocked(tid) and self.s["tricks"].get(tid, 0) > 0 and now - self._last_hint > 6:
                self._last_hint = now
                self.c.perform("confused", 2, "confused", "confused_tilt",
                               f"'{TRICKS[tid]['name']}' 아직 연습 중이에요 ({self.s['tricks'].get(tid, 0)}%)")

    def _stable(self, label, frames):
        return self._streak_label == label and self._streak >= frames

    # ---------- tricks ----------
    def _trick_move(self, tid):
        if tid == "custom":
            steps = list(self.s["custom_steps"]) or ["wiggle"]
            return (lambda: self.robot.run_steps(steps)) if self.robot else None
        return TRICKS[tid]["move"]

    def _show_trick(self, tid):
        t = TRICKS[tid]
        if self.s["energy"] < 10:
            return self._too_tired()
        self.c.perform(t["face"], 3, t["sound"], self._trick_move(tid), f"{t['icon']} {t['name']}! 짠~", wait=False)
        self._change(energy=-5, happiness=3)
        self._count("show")
        self.add_xp(2)

    def _too_tired(self):
        self.c.perform("sleepy", 3, "night", "doze", "너무 피곤해요… 재워 주세요 💤")
        return False

    def _set_activity(self, **kw):
        with self._lock:
            self.activity = dict(kw) if kw.get("type") else None

    def _phase(self, phase, msg, **extra):
        with self._lock:
            if self.activity:
                self.activity.update(phase=phase, msg=msg, **extra)

    def _wait(self, cond, seconds):
        end = time.time() + seconds
        while time.time() < end:
            if self._cancel.is_set():
                return None
            if cond():
                return True
            time.sleep(0.05)
        return False

    def train(self, tid):
        if tid not in TRICKS:
            return "그런 개인기는 없어요"
        if not self.unlocked("train") or not self.unlocked(tid):
            return self.gate(tid) or self.gate("train")
        if tid == "custom" and not self.s["custom_steps"]:
            return "먼저 '나만의 개인기' 동작을 만들어 주세요"
        return self._start("train", self._train, tid)

    def _start(self, kind, target, *args):
        if self.activity:
            return "다른 놀이를 하는 중이에요"
        if self.c.sleeping:
            return "자는 중이에요… 먼저 깨워 주세요"
        if self.s["energy"] < 10:
            self._too_tired()
            return "너무 피곤해요… 재워 주세요"
        self._cancel.clear()
        self._set_activity(type=kind, phase="start", msg="", started=time.time())
        threading.Thread(target=self._run_activity, args=(target, args), daemon=True).start()
        return None

    def _run_activity(self, target, args):
        try:
            target(*args)
        finally:
            time.sleep(2.5)                     # leave the result on screen for a moment
            self._set_activity()

    def _train(self, tid):
        t = TRICKS[tid]
        prof = self.s["tricks"].get(tid, 0)
        self._wait(lambda: not self.c.busy, 5)
        self._phase("cue", f"{t['cue_icon']} '{t['cue_text']}' 손 모양을 보여 주세요", trick=tid, cue_icon=t["cue_icon"])
        self.face.show("neutral", 10)
        self._streak_label, self._streak = None, 0
        seen = self._wait(lambda: self._stable(t["cue"], 5), 12)
        if not seen:
            self._phase("done", "손 모양을 못 봤어요. 다시 해 볼까요?" if seen is False else "훈련을 그만뒀어요", result="none")
            return
        success = prof >= 100 or random.random() < 0.3 + 0.7 * prof / 100
        self._phase("acting", "보고 있어요… 👀")
        if success:
            self.c.perform(t["face"], 3, t["sound"], self._trick_move(tid), f"{t['icon']} {t['name']}!", wait=True)
        else:
            wrong = random.choice(["confused_tilt", "look_around", "wiggle"])
            self.c.perform("confused", 3, "confused", wrong, "어… 이거였나? 🤔", wait=True)
        self._change(energy=-4)
        self._reward = None
        self._streak_label, self._streak = None, 0
        self._phase("reward", "잘했으면 👍 엄지 척(또는 '잘했어'), 틀렸으면 ✋ 손바닥(또는 '아니야')", success=success)
        self._wait(lambda: self._reward is not None or self._stable("thumbs_up", 3) or self._stable("paper", 5), 8)
        good = self._reward if self._reward is not None else (
            True if self._stable("thumbs_up", 3) else False if self._stable("paper", 5) else None)
        self._finish_training(tid, success, good)

    def reward(self, good):
        if self.activity and self.activity.get("type") == "train" and self.activity.get("phase") == "reward":
            self._reward = bool(good)
            return None
        return "지금은 보상할 때가 아니에요"

    def _finish_training(self, tid, success, good):
        t = TRICKS[tid]
        gain = 2 if self.s["demo"] else 1
        before = self.s["tricks"].get(tid, 0)
        if success and good:
            delta, msg, xp = 15 * gain, "칭찬받았다! 💕 숙련도가 올랐어요", 6
            self.c.perform("love", 3, "love", "shy_back", "칭찬받았다! 💕")
            self._change(happiness=5)
            self._count("praise")
        elif success and good is False:
            delta, msg, xp = 0, "잘한 건데… 😢 맞게 했을 땐 칭찬해 주세요", 1
            self.c.perform("sulky", 3, "sad", "huff", "잘한 건데… 😢")
            self._change(happiness=-5)
        elif not success and good:
            delta, msg, xp = -5, "틀린 걸 칭찬하면 헷갈려요 🤔", 1
            self.c.perform("confused", 3, "confused", "confused_tilt", "이게 맞는 거야…? 🤔")
        elif not success and good is False:
            delta, msg, xp = 5 * gain, "아하, 다시 해 볼게요! 💪 (조금 배웠어요)", 2
            self.c.perform("neutral", 2, "tick", "nibble", "다시 해 볼게! 💪")
        else:
            delta, msg, xp = (3 if success else 0), "반응이 없어서 잘 모르겠어요…", 1
        after = max(0, min(100, before + delta))
        with self._lock:
            self.s["tricks"][tid] = after
        self._count("train")
        self.add_xp(xp)
        self._last_interaction = time.time()
        self._phase("done", msg, result="good" if (success and good) or (not success and good is False) else "bad",
                    prof=after, delta=after - before)
        if before < 100 <= after:
            with self._lock:
                self.s["mastered_on"][tid] = _today()
            self._diary(f"개인기 '{t['name']}' 마스터! 이제 {t['cue_icon']} 신호만 보여 주면 해요")
            self._notify("master", f"{t['icon']} '{t['name']}' 마스터!", [f"{t['cue_icon']} {t['cue_text']} 신호를 보여 주면 언제든 해요", "+30 XP"])
            self._photo(f"개인기 '{t['name']}' 마스터")
            self.add_xp(30)
            self._when_free("text:MASTER", 3, "levelup", "happy_dance", f"'{t['name']}' 마스터! 🏆")

    # ---------- rock paper scissors ----------
    def rps(self):
        if not self.unlocked("rps"):
            return self.gate("rps")
        return self._start("rps", self._rps)

    def _rps(self):
        self._wait(lambda: not self.c.busy, 5)
        for word, num in (("가위…", "3"), ("바위…", "2"), ("보!", "1")):
            self._phase("count", f"✊✌️✋ {word}")
            self.face.show(f"text:{num}", 0.7)
            if self.robot:
                threading.Thread(target=self.robot.pattern, args=([(0.06, 0)],), daemon=True).start()
            if self._wait(lambda: False, 0.65) is None:
                return
        robot_move = random.choice(["rock", "paper", "scissors"])
        self.face.show(f"show_{robot_move}", 3)
        t0 = time.time()
        self._phase("show", "손을 내세요!", robot=robot_move)
        self._wait(lambda: False, 1.2)
        votes = Counter(l for t, l in list(self._labels) if t >= t0 - 0.3 and l in ("rock", "paper", "scissors"))
        if not votes:
            self._phase("done", "손을 못 봤어요… 다시 해요!", robot=robot_move, player=None, result="none")
            return
        player = votes.most_common(1)[0][0]
        beats = {"rock": "scissors", "scissors": "paper", "paper": "rock"}
        if player == robot_move:
            result, args = "draw", ("surprised", 3, "surprised", "wiggle", "비겼다! 한 번 더? 😮")
        elif beats[robot_move] == player:
            result, args = "robot", ("happy", 3, "win", "happy_dance", "내가 이겼다! 🎉")
        else:
            result, args = "player", ("sulky", 3, "lose", "huff", "졌다… 다시 해! 😤")
        self.c.perform(*args)
        key = {"draw": "draw", "robot": "win", "player": "lose"}[result]
        with self._lock:
            self.s["rps"][key] += 1
        self._change(happiness=4, energy=-3)
        self._count("rps")
        self.add_xp(3)
        self._last_interaction = time.time()
        self._phase("done", args[4], robot=robot_move, player=player, result=result)

    # ---------- come here ----------
    def come(self):
        if not self.unlocked("come"):
            return self.gate("come")
        return self._start("come", self._come)

    def _come(self):
        self._wait(lambda: not self.c.busy, 5)
        self.face.show("happy", 20)
        self._phase("follow", "👉 손을 보여 주세요. 손 쪽으로 갈게요!")
        end = time.time() + 20
        moving = self.robot and self.motion_on()
        while time.time() < end:
            if self._cancel.is_set():
                return
            hand = self._hand
            if hand and time.time() - hand[0] < 0.4:
                _, x, size = hand
                dx = x - 0.5
                if abs(dx) > 0.15:
                    self._phase("follow", "👀 손 쪽으로 방향을 트는 중…")
                    if moving:
                        self.robot.turn_pulse(FOLLOW_SIGN * (1 if dx > 0 else -1))
                        time.sleep(0.25)
                elif size < 0.2:
                    self._phase("follow", "🚗 가까이 가는 중…")
                    if moving:
                        self.robot.forward_pulse()
                        time.sleep(0.25)
                else:
                    self.c.perform("love", 3, "happy", "nuzzle", "왔다! 😊")
                    self._change(happiness=6, energy=-6)
                    self._count("come")
                    self.add_xp(4)
                    self._phase("done", "도착! 손 앞까지 왔어요 😊", result="good")
                    return
            time.sleep(0.05)
        self._phase("done", "손을 못 찾았어요… 🥺", result="none")

    def stop_activity(self):
        self._cancel.set()
        if self.robot:
            self.robot.stop()

    # ---------- care ----------
    def treat(self):
        if self.c.sleeping:
            return "자는 중이에요… 먼저 깨워 주세요"
        if self.s["treats_today"] >= 3:
            self.c.perform("shy", 2, "confused", "shy_fidget", "배불러요… 내일 또 주세요 😋")
            return "오늘 간식은 다 먹었어요 (하루 3번)"
        if not self.c.perform("love", 3, "treat", "nibble", "냠냠! 맛있다 🍪"):
            return "잠깐만요, 지금 바빠요"
        with self._lock:
            self.s["treats_today"] += 1
        self.c.glow("love", 20)
        self._change(happiness=15, energy=10)
        self._count("treat")
        self.add_xp(5)
        self._last_interaction = time.time()
        return None

    def sleep(self):
        if self.activity:
            return "놀이를 먼저 끝내 주세요"
        self.c.set_sleeping(True)
        self.c.perform("sleepy", 4, "night", "doze", "쿨쿨… 💤")
        self._diary("쿨쿨 잠들었어요 💤")
        return None

    def wake(self, auto=False):
        if not self.c.sleeping:
            return "이미 깨어 있어요"
        self.c.set_sleeping(False)
        self.c.glow("happy", 20)
        self.c.perform("happy", 3, "hello", "happy_wiggle", "잘 잤다! 에너지 충전 완료 ☀️" if auto else "잘 잤다! ☀️")
        return None

    # ---------- settings ----------
    def rename(self, name):
        name = (name or "").strip()[:12]
        if not name:
            return "이름을 입력해 주세요"
        with self._lock:
            self.s["name"] = name
        self._diary(f"새 이름: {name} 🏷️")
        return None

    def set_custom(self, steps):
        from robot import Robot
        steps = [s for s in steps if s in Robot.STEPS][:8]
        if not steps:
            return "동작을 하나 이상 골라 주세요"
        with self._lock:
            if steps != self.s["custom_steps"]:
                self.s["custom_steps"] = steps
                self.s["tricks"]["custom"] = 0          # a new routine has to be learned again
        self._dirty = True
        return None

    def delete_photo(self, name):
        """Remove one album photo (the entry and its file)."""
        with self._lock:
            entry = next((p for p in self.s["album"] if p["file"] == name), None)
            if entry is None:
                return "그 사진은 이미 없어요"
            self.s["album"].remove(entry)
        self._dirty = True
        path = ALBUM_DIR / Path(name).name               # only plain file names inside album/
        try:
            path.unlink()
        except OSError:
            pass                                         # already gone - the album entry is what matters
        self._save()
        return None

    def reroll_voice(self):
        with self._lock:
            self.s["voice_seed"] = random.getrandbits(32)
        self._dirty = True
        self._diary("목소리가 새로 바뀌었어요 🎵")
        self.c.perform("surprised", 2, "hello", "happy_wiggle", "어? 내 목소리가 바뀌었어! 🎵")
        return None

    def set_demo(self, on):
        with self._lock:
            self.s["demo"] = bool(on)
        self._dirty = True

    # ---------- background ----------
    def _tick(self):
        last = time.time()
        sec = 0
        while True:
            time.sleep(1)
            now = time.time()
            sec += 1
            self._new_day()
            with self._lock:
                if not self.c.sleeping:
                    self.s["awake_sec"] += 1
                if self.robot is not None:            # wheel odometry estimate from motor commands
                    moved = self.robot.take_distance()
                    if moved:
                        self.s["distance_m"] += moved
            self._dirty = True                        # time counters change every second; saved every 10 s
            present = now - self._last_present < 30 and self.active()
            if present:
                with self._lock:
                    self.s["together_sec"] += 1
                if sec % 60 == 0:
                    self._count("together")
                    with self._lock:
                        mins = self.s["xp_today"].get("together", 0)
                        self.s["xp_today"]["together"] = mins + 1
                    if mins < TOGETHER_XP_CAP:
                        self.add_xp(1)
                if sec % 120 == 0:
                    self._change(happiness=1)
            if now - self._last_interaction > 180 and sec % 180 == 0:
                self._change(happiness=-1)                 # misses you
            if self.c.sleeping:
                if sec % 3 == 0:
                    self._change(energy=1)
                if self.s["energy"] >= 100 and self.active():
                    self.wake(auto=True)
            elif sec % 120 == 0:
                self._change(energy=1)
            if (self.level >= UNLOCK_BY_ID["aegyo"]["level"] and present and self.s["happiness"] >= 80
                    and self.activity is None and not self.c.busy and not self.c.sleeping and random.random() < 1 / 150):
                self.c.perform("love", 3, "love", "aegyo", "헤헤… 좋아해요 🥰")
            if self._dirty and now - last > 10:
                last = now
                self._save()

    # ---------- 라즈봇 card (vet book) ----------
    def card(self):
        """Lifetime record + badges, drawn into a shareable card by static/card.js."""
        with self._lock:
            s = self.s
            t = dict(s["totals"])
            lv = self.level
            mastered = [tid for tid in TRICKS if s["tricks"].get(tid, 0) >= 100]
            rps_games = sum(s["rps"].values())
            fav_keys = {"hello": "인사", "pet": "쓰담쓰담", "high_five": "하이파이브", "treat": "간식",
                        "rps": "가위바위보", "show": "개인기 자랑", "come": "이리 와"}
            fav = max(fav_keys, key=lambda k: t.get(k, 0))
            stats = {
                "days": (date.today() - date.fromisoformat(s["born"])).days + 1,
                "together_h": round(s["together_sec"] / 3600, 1),
                "awake_h": round(s["awake_sec"] / 3600, 1),
                "distance_m": round(s["distance_m"], 1),
                "hello": t.get("hello", 0), "pet": t.get("pet", 0), "high_five": t.get("high_five", 0),
                "praise": t.get("praise", 0), "treat": t.get("treat", 0), "train": t.get("train", 0),
                "show": t.get("show", 0), "come": t.get("come", 0), "scared": t.get("scared", 0),
                "rps_games": rps_games, "rps": dict(s["rps"]),
                "best_streak": max(s["best_streak"], s["streak"]),
            }
            badges = [
                ("🌱", "첫 만남", "라즈봇을 처음 만났어요", True),
                ("🤝", "단짝", "레벨 5 달성", lv >= 5),
                ("💯", "최고의 친구", "레벨 10 달성", lv >= MAX_LEVEL),
                ("🤚", "쓰담 장인", "쓰담쓰담 50번", stats["pet"] >= 50),
                ("👋", "인사왕", "인사 30번", stats["hello"] >= 30),
                ("🍪", "간식 요정", "간식 20번", stats["treat"] >= 20),
                ("🎓", "첫 개인기", "개인기 하나 마스터", len(mastered) >= 1),
                ("🏆", "개인기 박사", "개인기 3개 마스터", len(mastered) >= 3),
                ("✊", "가위바위보 고수", "가위바위보 20판", rps_games >= 20),
                ("🔥", "꾸준한 친구", "할 일 3일 연속 완료", stats["best_streak"] >= 3),
                ("⏰", "10시간 친구", "함께한 시간 10시간", stats["together_h"] >= 10),
                ("🕊️", "다정한 손", "한 번도 위협하지 않고 레벨 5", lv >= 5 and stats["scared"] == 0),
            ]
            return {
                "name": s["name"], "level": lv, "max_level": MAX_LEVEL, "xp": s["xp"], "born": s["born"],
                "happiness": s["happiness"], "energy": s["energy"], "mood": self.c.mood,
                "favorite": fav_keys[fav] if t.get(fav, 0) else None,
                "tricks": [{"name": TRICKS[tid]["name"], "icon": TRICKS[tid]["icon"], "on": s["mastered_on"].get(tid)}
                           for tid in mastered],
                "stats": stats,
                "badges": [{"icon": i, "name": n, "desc": d, "earned": e} for i, n, d, e in badges],
                "photo": s["album"][0]["file"] if s["album"] else None,
            }

    # ---------- page state ----------
    def snapshot(self):
        with self._lock:
            s = self.s
            lv = self.level
            cur = s["xp"] - LEVEL_XP[lv - 1]
            need = LEVEL_XP[lv] - LEVEL_XP[lv - 1] if lv < MAX_LEVEL else None
            unlocks = [dict(u, unlocked=lv >= u["level"]) for u in UNLOCKS]
            tricks = [{"id": tid, "name": t["name"], "icon": t["icon"], "level": t["level"], "cue_icon": t["cue_icon"],
                       "cue_text": t["cue_text"], "unlocked": lv >= t["level"], "prof": s["tricks"].get(tid, 0),
                       "mastered": s["tricks"].get(tid, 0) >= 100} for tid, t in TRICKS.items()]
            quests = [dict(q, progress=min(s["counters"].get(q["key"], 0), q["target"])) for q in s["quests"]]
            born = date.fromisoformat(s["born"])
            next_unlocks = [f"{u['icon']} {u['name']}" for u in UNLOCKS if u["level"] == lv + 1]
            next_unlocks += [f"{t['icon']} {t['name']}" for t in TRICKS.values() if t["level"] == lv + 1]
            return {
                "name": s["name"], "level": lv, "max_level": MAX_LEVEL, "xp": s["xp"], "xp_cur": cur, "xp_need": need,
                "happiness": s["happiness"], "energy": s["energy"], "unlocks": unlocks, "tricks": tricks,
                "next_unlocks": next_unlocks, "quests": quests, "streak": s["streak"],
                "treats_left": max(0, 3 - s["treats_today"]), "album": s["album"][:24], "diary": s["diary"][:30],
                "rps": s["rps"], "together_min_today": s["counters"].get("together", 0),
                "together_hours": round(s["together_sec"] / 3600, 1), "days": (date.today() - born).days + 1,
                "demo": s["demo"], "custom_steps": s["custom_steps"], "activity": dict(self.activity) if self.activity else None,
                "notice": self.notice, "label": self._streak_label, "voice_seed": s["voice_seed"],
            }
