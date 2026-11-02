#!/bin/sh
# Open the robot to the game website (https) through a free Cloudflare Quick Tunnel.
# Prints the https address and the access code to type into the site's "라즈봇 연결" box.
# Stop with Ctrl+C; the address changes every time the tunnel starts.
set -e
cd "$(dirname "$0")"

CF=cloudflared
if ! command -v cloudflared >/dev/null 2>&1; then
  CF=./bin/cloudflared
  if [ ! -x "$CF" ]; then
    echo "cloudflared 내려받는 중..."
    mkdir -p bin
    case "$(uname -m)" in
      aarch64|arm64) arch=arm64 ;;
      armv7l) arch=arm ;;
      *) arch=amd64 ;;
    esac
    curl -sSL -o "$CF" "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$arch"
    chmod +x "$CF"
  fi
fi

# access code: visitors through the tunnel must send it (local Wi-Fi access stays open)
if [ ! -s .token ]; then
  python3 -c "import secrets; print(secrets.token_hex(2) + '-' + secrets.token_hex(2))" > .token
  chmod 600 .token
fi

./run.sh "$@"                       # restart the app so it picks up the access code
sleep 3

LOG=$(mktemp)
"$CF" tunnel --no-autoupdate --url http://localhost:5000 > "$LOG" 2>&1 &
CF_PID=$!
trap 'kill $CF_PID 2>/dev/null; rm -f "$LOG"' INT TERM EXIT

for _ in $(seq 1 30); do
  URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -1)
  [ -n "$URL" ] && break
  sleep 1
done
if [ -z "$URL" ]; then
  echo "터널을 열지 못했어요:"; tail -20 "$LOG"; exit 1
fi

echo
echo "=============================================="
echo "  라즈봇 주소 : $URL"
echo "  접속 코드   : $(cat .token)"
echo "=============================================="
echo "게임 사이트의 '🔌 라즈봇 연결'에 위 두 가지를 넣어 주세요. (끄려면 Ctrl+C)"
wait $CF_PID
