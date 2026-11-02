"""Companion mode: the robot reads hand interactions and answers with face, sound and body language.

Interactions (camera)            Reaction
  wave (fast side-to-side)   ->  hello / good morning / good night
  open palm held still       ->  high five
  slow side-to-side stroke   ->  being petted (love face, gentle nuzzle)
  thumbs up                  ->  praise (heart, shy back-off)
  fist swung / thrust at it  ->  scared: flinches back, trembles for a while
  nobody for a while         ->  bored -> asks to play -> sulks and turns away
  hand after a long absence  ->  surprised, then happy

The pet game (petgame.py) plugs in through hooks: it can lock interactions until a level is
reached, receives every reaction as an event, and colours the mood with happiness / energy.
"""
import math
import random
import threading
import time
from collections import deque

from robot import BUZZ

BORED_AFTER = 45          # s without a hand -> bored face
CALL_EVERY = 90           # s between "play with me" calls
CALLS_BEFORE_SULK = 3
SURPRISE_AFTER = 30       # s of absence before a new hand is a surprise
STABLE_FRAMES = 4

# buzzer: one pitch, so each emotion is a number of beeps (see robot.BUZZ)
SOUNDS = BUZZ

REACTIONS = {
    # event: (face, hold seconds, sound, body move, korean label)
    "hello": ("happy", 3, "hello", "greet", "안녕! 👋"),
    "morning": ("happy", 4, "hello", "happy_wiggle", "좋은 아침! ☀️"),
    "night": ("sleepy", 6, "night", "greet", "잘 자… 🌙"),
    "high_five": ("happy", 2.5, "happy", "high_five", "하이파이브! ✋"),
    "pet": ("love", 4, "love", "nuzzle", "쓰담쓰담 💕"),
    "praise": ("love", 3, "love", "shy_back", "칭찬 고마워 👍"),
    "surprised": ("surprised", 2, "surprised", "surprised_jump", "깜짝이야! 😮"),
    "call": ("bored", 4, "call", "ask_to_play", "놀아줘~ 🥺"),
    "sulk": ("sulky", 6, "sad", "sulk_turn", "흥! 삐졌어 😤"),
    "happy": ("happy", 3, "happy", "happy_wiggle", "기분 좋아! 😊"),
    "shy": ("shy", 3, "love", "shy_back", "부끄러워 ☺️"),
    "scared": ("scared", 3, "scared", "flinch", "무, 무서워… 😨"),
}

# how long a reaction keeps colouring the mood afterwards: event -> (mood, seconds)
MOOD_AFTER = {
    "hello": ("happy", 30), "morning": ("happy", 40), "high_five": ("happy", 30), "happy": ("happy", 40),
    "pet": ("love", 40), "praise": ("love", 30), "shy": ("shy", 15), "scared": ("scared", 12),
}

# which unlockable feature a camera-detected event belongs to (see petgame.UNLOCKS)
FEATURE_OF = {"hello": "hello", "morning": "hello", "night": "hello", "pet": "pet",
              "high_five": "high_five", "praise": "praise", "call": "call", "sulk": "call"}

# mood-driven body language while nothing else is happening:
# mood -> (min interval s, max interval s, robot method, description)
IDLE_MOVES = {
    "neutral": (8, 14, "look_around", "두리번두리번 주변 살피기"),
    "happy": (4, 7, "happy_dance", "신나서 들썩들썩 춤추기"),
    "love": (5, 8, "creep_closer", "살금살금 다가가 비비기"),
    "shy": (5, 8, "shy_fidget", "꼼지락꼼지락 몸 비틀기"),
    "bored": (6, 10, "wander", "심심해서 어슬렁어슬렁 돌아다니기"),
    "sleepy": (9, 14, "doze", "꾸벅꾸벅 졸기"),
    "sulky": (6, 9, "huff", "흥! 하고 고개 홱 돌리기"),
    "scared": (3, 5, "tremble", "벌벌 떨며 조금씩 물러나기"),
}
SHY_IDLE = (6, 10, "shy_fidget", "아직 낯가림… 꼼지락꼼지락")


class Companion:
    def __init__(self, robot, face, motion_on, sound_on, active=lambda: True):
        self.robot = robot
        self.face = face
        self.motion_on = motion_on      # callables -> bool
        self.sound_on = sound_on
        self.active = active            # callable -> bool (companion mode selected)
        # hooks set by the pet game
        self.gate = lambda feature: None        # -> None if allowed, else a "not yet" message
        self.on_event = lambda event: None      # every reaction that actually played
        self.level = lambda: 10
        self.need_mood = lambda: None           # e.g. "sleepy" when out of energy
        self.suspended = lambda: False          # True while a game activity owns the camera
        self.events = deque(maxlen=20)
        self.mood = "neutral"
        self._track = deque()           # (t, x, label) of recent hand positions
        self._fist = deque()            # (t, x, y, size, label) over the last 0.6 s, for threats
        self._last_seen = time.time()
        self._streak_label, self._streak = None, 0
        self._busy = threading.Event()
        self._last_event_t = 0.0
        self._last_call = 0.0
        self._calls = 0
        self._sulking = False
        self._sleeping = False
        self._glow, self._glow_until = "neutral", 0.0
        self._next_move = time.time() + 3
        self._still_since = 0.0         # when the robot last stopped moving
        self._last_denied = 0.0
        self.last_move = None
        self._lock = threading.Lock()
        threading.Thread(target=self._behave, daemon=True).start()

    def _event_id(self):
        self._event_seq = getattr(self, "_event_seq", 0) + 1
        return self._event_seq

    @property
    def busy(self):
        return self._busy.is_set()

    @property
    def sleeping(self):
        return self._sleeping

    # ---------- per-frame input ----------
    def update(self, label, lm):
        now = time.time()
        if label is None:
            self._track.clear()
            self._fist.clear()
            self._streak_label, self._streak = None, 0
            if not self.suspended():
                self._idle(now)
            return

        absent = now - self._last_seen
        self._last_seen = now
        if label == self._streak_label:
            self._streak += 1
        else:
            self._streak_label, self._streak = label, 1
        if self._busy.is_set() or now - self._still_since < 0.5 or self.suspended():
            # the camera rides on the robot: while it moves, hand motion in the image is not the user's
            self._track.clear()
            self._fist.clear()
            return
        self._track.append((now, lm[0].x, label))
        while self._track and now - self._track[0][0] > 4.0:
            self._track.popleft()
        size = math.hypot(lm[0].x - lm[9].x, lm[0].y - lm[9].y)   # wrist -> middle knuckle
        self._fist.append((now, lm[9].x, lm[9].y, size, label))
        while self._fist and now - self._fist[0][0] > 0.6:
            self._fist.popleft()

        if now - self._last_event_t < 1.0:
            return
        self._calls = 0
        if self._is_threat(now):
            self._fist.clear()
            return self.trigger("scared")
        if absent > SURPRISE_AFTER and not self._sulking:
            return self.trigger("surprised")
        if self._is_wave(now):
            hour = time.localtime().tm_hour
            return self._gesture("morning" if 5 <= hour < 11 else "night" if hour >= 21 or hour < 5 else "hello")
        if label == "thumbs_up" and self._streak >= STABLE_FRAMES:
            self._streak = -10**6        # one praise per thumbs-up
            return self._gesture("praise")
        if self._is_stroke(now):
            return self._gesture("pet")
        if label == "paper" and self._is_still(now, 0.7):
            return self._gesture("high_five")
        self._refresh_mood(now)

    def _gesture(self, event):
        """A camera-detected interaction: play it, or look puzzled if the game has not unlocked it yet."""
        denied = self.gate(FEATURE_OF.get(event, event))
        if denied is None:
            return self.trigger(event)
        self._track.clear()
        now = time.time()
        if now - self._last_denied > 4:
            self._last_denied = now
            self.perform("confused", 2.5, "confused", "confused_tilt", denied)

    # ---------- gesture dynamics ----------
    @staticmethod
    def _reversals(pts, min_swing):
        """Count side-to-side direction changes (each swing >= min_swing); returns (count, swing durations)."""
        count, times = 0, []
        direction = 0
        ext_t, ext_x = pts[0]            # current extreme point
        turn_t = pts[0][0]               # time of the previous turning point
        for t, x in pts[1:]:
            if direction == 0:
                if abs(x - ext_x) >= min_swing:
                    direction = 1 if x > ext_x else -1
                    ext_t, ext_x = t, x
            elif (x - ext_x) * direction > 0:
                ext_t, ext_x = t, x      # keep extending the current swing
            elif abs(x - ext_x) >= min_swing:
                count += 1
                times.append(ext_t - turn_t)
                turn_t = ext_t
                direction = -direction
                ext_t, ext_x = t, x
        return count, times

    def _recent(self, now, window):
        return [(t, x) for t, x, _ in self._track if now - t <= window]

    def _is_wave(self, now):
        xs = self._recent(now, 1.5)
        if len(xs) < 8:
            return False
        count, _ = self._reversals(xs, 0.05)
        return count >= 3

    def _is_stroke(self, now):
        xs = self._recent(now, 4.0)
        if len(xs) < 20:
            return False
        count, times = self._reversals(xs, 0.15)
        return count >= 2 and all(dt >= 0.5 for dt in times)

    def _is_threat(self, now):
        """A fist thrust toward the camera (grows fast) or swung across it (moves fast)."""
        pts = [p for p in self._fist if now - p[0] <= 0.5]
        if len(pts) < 4 or pts[-1][4] != "rock" or sum(p[4] == "rock" for p in pts) < len(pts) / 2:
            return False
        _, x, y, size, _ = pts[-1]
        thrust = size / max(min(p[3] for p in pts), 1e-6) >= 1.45
        swing = max(math.hypot(x - p[1], y - p[2]) for p in pts) >= 0.25
        return thrust or swing

    def _is_still(self, now, seconds):
        pts = [(t, x, l) for t, x, l in self._track if now - t <= seconds]
        if not pts or now - pts[0][0] < seconds * 0.8 or any(l != "paper" for _, _, l in pts):
            return False
        xs = [x for _, x, _ in pts]
        return max(xs) - min(xs) < 0.04

    # ---------- mood ----------
    @staticmethod
    def _night():
        hour = time.localtime().tm_hour
        return hour >= 22 or hour < 7

    def _refresh_mood(self, now):
        """Pick the lasting mood: sulky > sleepy > needs (tired / lonely) > recent feeling > bored > neutral."""
        need = self.need_mood()
        if self._sulking:
            mood = "sulky"
        elif self._sleeping:
            mood = "sleepy"
        elif need == "sleepy":
            mood = "sleepy"
        elif now < self._glow_until:
            mood = self._glow
        elif need:
            mood = need
        elif now - self._last_seen > BORED_AFTER:
            mood = "sleepy" if self._night() else "bored"
        else:
            mood = "neutral"
        self._set_mood(mood)

    def _set_mood(self, mood):
        if mood != self.mood:
            self.mood = mood
            self.face.set_base(mood)
            self._next_move = time.time() + 1.5   # show the new mood's body language soon

    def set_mood(self, mood, seconds=60):
        """Force a mood from the web page (for demos)."""
        if mood not in IDLE_MOVES:
            return False
        self._sulking = mood == "sulky"
        self._sleeping = mood == "sleepy"
        self._glow, self._glow_until = mood, time.time() + seconds
        if mood in ("bored", "neutral"):
            self._glow_until = 0.0
            self._last_seen = time.time() - (BORED_AFTER + 1 if mood == "bored" else 0)
        self._refresh_mood(time.time())
        return True

    def set_sleeping(self, sleeping):
        self._sleeping = sleeping
        if sleeping:
            self._sulking = False
        self._refresh_mood(time.time())

    def glow(self, mood, seconds):
        """Keep a mood for a while (used by the game after treats, wins, level-ups...)."""
        self._glow, self._glow_until = mood, time.time() + seconds
        self._refresh_mood(time.time())

    # ---------- idle behaviour ----------
    def _idle(self, now):
        self._refresh_mood(now)
        if self._busy.is_set() or self._sulking or self._sleeping:
            return
        gone = now - self._last_seen
        if gone > BORED_AFTER + 15 and not self._night() and now - self._last_call > CALL_EVERY:
            self._last_call = now
            if self.gate("call") is not None:
                return                   # too shy to ask for attention yet
            if self._calls >= CALLS_BEFORE_SULK:
                self._sulking = True
                self._calls = 0
                self.trigger("sulk")
            else:
                self._calls += 1
                self.trigger("call")

    def _behave(self):
        """Background loop: perform the current mood's body language every few seconds."""
        while True:
            time.sleep(0.3)
            now = time.time()
            if not (self.robot and self.active() and self.motion_on()) or self._busy.is_set() or self.suspended():
                continue
            if now < self._next_move or now - self._last_event_t < 2.0:
                continue
            lo, hi, move, text = IDLE_MOVES.get(self.mood, IDLE_MOVES["neutral"])
            if self.mood == "neutral" and self.level() < 3:
                lo, hi, move, text = SHY_IDLE         # a new pet is still shy
            if self.mood == "happy":                  # the more it likes you, the livelier it gets
                hi = max(lo, hi - self.level() // 2)
            self._next_move = now + random.uniform(lo, hi)
            self._busy.set()
            self.last_move = {"time": time.strftime("%H:%M:%S"), "mood": self.mood, "text": text}
            try:
                getattr(self.robot, move)()
            except OSError:
                pass  # transient I2C error
            finally:
                self.robot.stop()
                self._still_since = time.time()
                self._busy.clear()

    # ---------- reactions ----------
    def trigger(self, event):
        """Play a built-in reaction (camera events and the web test buttons)."""
        if event not in REACTIONS or self._busy.is_set():
            return False
        face, hold, sound, move, text = REACTIONS[event]
        self._sleeping = event == "night"
        if event not in ("call", "sulk", "surprised", "scared"):
            # a sulking robot stays sulky until it is greeted, praised, petted or high-fived
            self._sulking = False
        if event in MOOD_AFTER:
            mood, secs = MOOD_AFTER[event]
            self._glow, self._glow_until = mood, time.time() + hold + secs
        ok = self.perform(face, hold, sound, move, text, event=event)
        if ok:
            self.on_event(event)
        return ok

    def perform(self, face, hold, sound, move, text, event=None, wait=False):
        """Show a face, play a buzzer rhythm and a body move together. Returns False if already busy."""
        if self._busy.is_set():
            return False
        self._busy.set()
        self._last_event_t = time.time()
        self._refresh_mood(time.time())
        with self._lock:
            # "sound" lets the web page voice the same emotion through the browser (web/static/voice.js)
            self.events.appendleft({"time": time.strftime("%H:%M:%S"), "event": event or (move if isinstance(move, str) else "move"),
                                    "text": text, "sound": sound, "id": self._event_id()})
        self.face.show(face, hold)

        def run():
            try:
                threads = []
                if self.robot and self.sound_on() and SOUNDS.get(sound):
                    threads.append(threading.Thread(target=self.robot.pattern, args=(SOUNDS[sound],)))
                if self.robot and self.motion_on() and move:
                    target = move if callable(move) else getattr(self.robot, move)
                    threads.append(threading.Thread(target=target))
                for th in threads:
                    th.start()
                for th in threads:
                    th.join()
                time.sleep(0.5)
            except OSError:
                pass  # transient I2C error
            finally:
                if self.robot:
                    self.robot.stop()
                    self.robot.buzzer(False)
                self._still_since = time.time()
                self._busy.clear()

        if wait:
            run()
        else:
            threading.Thread(target=run, daemon=True).start()
        return True

    def snapshot(self):
        with self._lock:
            glow_left = max(0.0, self._glow_until - time.time()) if self.mood == self._glow else 0.0
            return {"mood": self.mood, "face": self.face.current(), "events": list(self.events),
                    "busy": self._busy.is_set(), "sulking": self._sulking, "sleeping": self._sleeping,
                    "behavior": IDLE_MOVES.get(self.mood, IDLE_MOVES["neutral"])[3],
                    "last_move": self.last_move, "mood_left": round(glow_left)}
