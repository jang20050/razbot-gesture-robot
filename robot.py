"""Raspbot V2 motor/buzzer control over I2C (expansion board at 0x2B)."""
import random
import time

ADDR = 0x2B
REG_MOTOR = 0x01
REG_BUZZER = 0x06

# motor ids: 0=left front, 1=left rear, 2=right front, 3=right rear
LEFT = (0, 1)
RIGHT = (2, 3)

# rough wheel odometry: metres per second per speed unit (no encoders; calibrate on your floor)
M_PER_UNIT_S = 0.002


def beeps(n, on=0.08, off=0.12):
    """n beeps of the same length: [(on, off), ...] with no trailing pause."""
    return [(on, off)] * (n - 1) + [(on, 0)]


# The buzzer has a single pitch, so emotions are told apart only by HOW MANY beeps and HOW LONG.
# (The creature voice with real pitch plays in the browser - web/static/voice.js.)
BUZZ = {
    "hello": beeps(1),                                   # 삐            인사
    "tick": beeps(1, on=0.05),                           # 삑            가위바위보 구호
    "happy": beeps(2),                                   # 삐삐          기쁨, 하이파이브
    "trick": beeps(2),                                   # 삐삐          개인기
    "win": beeps(2),                                     # 삐삐          이겼다
    "love": beeps(3, off=0.2),                           # 삐 삐 삐      쓰담쓰담, 칭찬
    "treat": beeps(3, off=0.2),                          # 삐 삐 삐      간식
    "call": beeps(2, on=0.4, off=0.3),                   # 삐— 삐—       놀아줘
    "confused": beeps(2, on=0.4, off=0.3),               # 삐— 삐—       갸우뚱
    "sad": beeps(1, on=0.8),                             # 삐———         시무룩, 삐짐
    "lose": beeps(1, on=0.8),                            # 삐———         졌다
    "night": beeps(1, on=0.8),                           # 삐———         잘 자
    "dead": beeps(1, on=0.8),                            # 삐———         죽은 척
    "surprised": beeps(5, on=0.03, off=0.03),            # 삐삐삐삐삐    놀람
    "scared": beeps(5, on=0.03, off=0.03),               # 삐삐삐삐삐    무서움
    "levelup": beeps(4, on=0.06, off=0.06),              # 삐삐삐삐      레벨업, 세레머니
    "none": [],
}


class Robot:
    def __init__(self, bus=1):
        import smbus  # only on the Pi; importing robot.py elsewhere (e.g. for STEPS) must still work

        self.bus = smbus.SMBus(bus)
        self._cmd = (0, 0, time.monotonic())   # last (left, right, time) for odometry
        self._distance = 0.0
        self.buzz_mode = "normal"              # "off" | "quiet" | "normal" - see pattern()

    def _motor(self, mid, speed):
        direction = 0 if speed >= 0 else 1
        self.bus.write_i2c_block_data(ADDR, REG_MOTOR, [mid, direction, min(abs(int(speed)), 255)])

    def drive(self, left, right):
        now = time.monotonic()
        l0, r0, t0 = self._cmd
        self._distance += abs(l0 + r0) / 2 * (now - t0) * M_PER_UNIT_S   # turning in place covers no distance
        self._cmd = (left, right, now)
        for m in LEFT:
            self._motor(m, left)
        for m in RIGHT:
            self._motor(m, right)

    def take_distance(self):
        """Metres driven since the last call (estimate)."""
        d, self._distance = self._distance, 0.0
        return d

    def stop(self):
        self.drive(0, 0)

    def buzzer(self, on):
        self.bus.write_byte_data(ADDR, REG_BUZZER, 1 if on else 0)

    # --- composite moves ---
    def forward(self, speed=80, t=0.5):
        self.drive(speed, speed); time.sleep(t); self.stop()

    def backward(self, speed=80, t=0.5):
        self.drive(-speed, -speed); time.sleep(t); self.stop()

    def spin(self, speed=100, t=1.2):
        self.drive(speed, -speed); time.sleep(t); self.stop()

    def wiggle(self, speed=80, times=2):
        for _ in range(times):
            self.drive(speed, -speed); time.sleep(0.2)
            self.drive(-speed, speed); time.sleep(0.2)
        self.stop()

    def beep(self, t=0.15):
        self.pattern([(t, 0)])

    def pattern(self, beats):
        """Play a buzzer rhythm: beats = [(on_seconds, off_seconds), ...]. The buzzer has a single pitch.

        buzz_mode (set from the web page): "off" = silent, "quiet" = same count, much shorter beeps
        (the buzzer is on/off only, so shorter is the only way to be softer), "normal".
        """
        if self.buzz_mode == "off":
            return
        scale = 0.35 if self.buzz_mode == "quiet" else 1.0
        for on, off in beats:
            self.buzzer(True); time.sleep(max(0.015, on * scale))
            self.buzzer(False); time.sleep(off)

    # --- body language ---
    def happy_wiggle(self, speed=80):
        self.wiggle(speed=speed, times=3)

    def shy_back(self, speed=50):
        self.backward(speed=speed, t=0.35)

    def sulk_turn(self, speed=90, t=1.0):
        """Turn the back to the user (roughly half a turn; tune t on your floor)."""
        self.drive(speed, -speed); time.sleep(t); self.stop()

    def greet(self, speed=60):
        for _ in range(2):                                 # little bow + sway
            self.drive(speed, speed); time.sleep(0.15)
            self.drive(-speed, -speed); time.sleep(0.15)
        self.wiggle(speed=speed, times=1)

    def high_five(self, speed=90):
        self.drive(speed, speed); time.sleep(0.2)
        self.stop(); time.sleep(0.15)
        self.drive(-speed, -speed); time.sleep(0.2)
        self.stop()

    def nuzzle(self, speed=45):
        for _ in range(2):                                 # slow, gentle rub
            self.drive(speed, -speed); time.sleep(0.3)
            self.drive(-speed, speed); time.sleep(0.3)
        self.stop()

    def ask_to_play(self, speed=70):
        self.forward(speed=speed, t=0.4)
        self.wiggle(speed=speed, times=2)

    def surprised_jump(self, speed=120):
        self.drive(-speed, -speed); time.sleep(0.12); self.stop()

    def flinch(self, speed=130):
        """Startled by a threat: jerk back fast, freeze, then shuffle a little further away."""
        self.drive(-speed, -speed); time.sleep(0.3)
        self.stop(); time.sleep(0.5)
        for _ in range(3):                                 # nervous shiver
            self.drive(40, -40); time.sleep(0.05)
            self.drive(-40, 40); time.sleep(0.05)
        self.stop(); time.sleep(0.3)
        self.drive(-50, -50); time.sleep(0.4)
        self.stop()

    # --- mood idle moves (short, gentle; used repeatedly while a mood lasts) ---
    def tremble(self, speed=45):
        """scared: shiver in place and inch backwards."""
        for _ in range(4):
            self.drive(speed, -speed); time.sleep(0.05)
            self.drive(-speed, speed); time.sleep(0.05)
        self.drive(-40, -40); time.sleep(0.15)
        self.stop()

    def look_around(self, speed=60):
        """neutral: glance left, then right, then back."""
        self.drive(-speed, speed); time.sleep(0.15); self.stop(); time.sleep(0.5)
        self.drive(speed, -speed); time.sleep(0.3); self.stop(); time.sleep(0.5)
        self.drive(-speed, speed); time.sleep(0.15); self.stop()

    def happy_dance(self, speed=85):
        """happy: quick wiggle and a little hop."""
        for _ in range(3):
            self.drive(speed, -speed); time.sleep(0.12)
            self.drive(-speed, speed); time.sleep(0.12)
        self.drive(speed, speed); time.sleep(0.12)
        self.drive(-speed, -speed); time.sleep(0.12)
        self.stop()

    def creep_closer(self, speed=40):
        """love: creep forward a bit and rub."""
        self.drive(speed, speed); time.sleep(0.3); self.stop(); time.sleep(0.2)
        self.drive(speed, -speed); time.sleep(0.25)
        self.drive(-speed, speed); time.sleep(0.25)
        self.stop()

    def shy_fidget(self, speed=45):
        """shy: back off a little and twist."""
        self.drive(-speed, -speed); time.sleep(0.15); self.stop(); time.sleep(0.3)
        self.drive(speed, -speed); time.sleep(0.1)
        self.drive(-speed, speed); time.sleep(0.1)
        self.stop()

    def wander(self, speed=50):
        """bored: turn a random way and roll a short distance."""
        turn = random.uniform(0.2, 0.5) * random.choice((-1, 1))
        self.drive(speed if turn > 0 else -speed, -speed if turn > 0 else speed); time.sleep(abs(turn))
        self.stop(); time.sleep(0.3)
        self.drive(speed, speed); time.sleep(0.4)
        self.stop()

    def doze(self, speed=35):
        """sleepy: slow nod forward and back."""
        self.drive(speed, speed); time.sleep(0.2); self.stop(); time.sleep(0.6)
        self.drive(-speed, -speed); time.sleep(0.2); self.stop()

    def huff(self, speed=100):
        """sulky: snap the head away, then slowly back."""
        self.drive(speed, -speed); time.sleep(0.12); self.stop(); time.sleep(0.8)
        self.drive(-40, 40); time.sleep(0.25); self.stop()

    # --- pet game: tricks and small actions ---
    def confused_tilt(self, speed=50):
        """Puzzled: tilt one way, pause, tilt back."""
        self.drive(speed, -speed); time.sleep(0.12); self.stop(); time.sleep(0.6)
        self.drive(-speed, speed); time.sleep(0.12); self.stop()

    def bow(self, speed=60):
        """Trick: polite bow - lean forward, hold, come back."""
        self.drive(speed, speed); time.sleep(0.25); self.stop(); time.sleep(0.7)
        self.drive(-speed, -speed); time.sleep(0.25); self.stop()

    def dance(self, speed=90):
        """Trick: a little dance routine."""
        for _ in range(2):
            self.drive(speed, -speed); time.sleep(0.15)
            self.drive(-speed, speed); time.sleep(0.15)
        self.spin(speed=speed + 10, t=0.7)
        for _ in range(2):
            self.drive(speed, speed); time.sleep(0.15)
            self.drive(-speed, -speed); time.sleep(0.15)
        self.spin(speed=-(speed + 10), t=0.7)
        self.stop()

    def play_dead(self, speed=60):
        """Trick: stagger back, freeze for a while, then jump back to life."""
        self.drive(-speed, -speed); time.sleep(0.2)
        self.drive(speed, -speed); time.sleep(0.15)
        self.drive(-speed, speed); time.sleep(0.15)
        self.stop(); time.sleep(2.5)
        self.wiggle(speed=90, times=2)

    def nibble(self, speed=50):
        """Eating a treat: quick little forward pecks."""
        for _ in range(3):
            self.drive(speed, speed); time.sleep(0.1)
            self.drive(-speed, -speed); time.sleep(0.1)
        self.stop()

    def aegyo(self, speed=70):
        """Being cute: slow sway, half turn each way, wiggle."""
        self.drive(-speed, speed); time.sleep(0.35)
        self.drive(speed, -speed); time.sleep(0.7)
        self.drive(-speed, speed); time.sleep(0.35)
        self.wiggle(speed=60, times=2)

    def turn_pulse(self, direction, speed=60, t=0.12):
        """Short turn used when following a hand: direction +1 = left, -1 = right."""
        self.drive(-speed * direction, speed * direction); time.sleep(t); self.stop()

    def forward_pulse(self, speed=50, t=0.2):
        self.drive(speed, speed); time.sleep(t); self.stop()

    STEPS = {
        "forward": "앞으로", "backward": "뒤로", "left": "왼쪽 돌기", "right": "오른쪽 돌기",
        "spin": "빙글", "wiggle": "흔들흔들", "beep": "삐!", "pause": "잠깐 멈춤",
    }

    def run_steps(self, steps, speed=70):
        """Play a user-composed routine (custom trick); unknown steps are skipped."""
        for step in steps:
            if step == "forward":
                self.forward(speed=speed, t=0.35)
            elif step == "backward":
                self.backward(speed=speed, t=0.35)
            elif step == "left":
                self.drive(-speed, speed); time.sleep(0.3); self.stop()
            elif step == "right":
                self.drive(speed, -speed); time.sleep(0.3); self.stop()
            elif step == "spin":
                self.spin(speed=speed + 30, t=1.2)
            elif step == "wiggle":
                self.wiggle(speed=speed, times=2)
            elif step == "beep":
                self.beep(0.15)
            elif step == "pause":
                time.sleep(0.5)
            time.sleep(0.1)
        self.stop()

    def celebrate(self, speed=90):
        """Goal / home-run celebration: beeps, a full spin, small back-and-forth and left-right moves."""
        try:
            self.pattern(BUZZ["levelup"])                      # 삐삐삐삐
            self.spin(speed=speed + 20, t=1.4)                 # spin around
            for _ in range(2):                                 # little hops forward / back
                self.drive(speed, speed); time.sleep(0.25)
                self.drive(-speed, -speed); time.sleep(0.25)
            self.stop()
            for _ in range(2):                                 # turn a bit left / right
                self.drive(-speed, speed); time.sleep(0.2)
                self.drive(speed, -speed); time.sleep(0.2)
            self.spin(speed=-(speed + 20), t=1.4)              # spin back the other way
            self.pattern(BUZZ["happy"])                        # 삐삐
        finally:
            self.stop()


if __name__ == "__main__":
    import sys
    r = Robot()
    try:
        for mid in range(4):
            print(f"motor {mid} forward")
            r._motor(mid, 60); time.sleep(0.6); r._motor(mid, 0); time.sleep(0.3)
        if "--moves" in sys.argv:
            print("forward"); r.forward()
            print("backward"); r.backward()
            print("spin"); r.spin()
            print("wiggle"); r.wiggle()
        print("beep"); r.beep()
    finally:
        r.stop()
