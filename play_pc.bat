@echo off
rem Play the pet game on a Windows PC without the robot (uses the PC webcam for hand signs).
chcp 65001 >nul
cd /d "%~dp0"
if not exist hand_landmarker.task (
  echo Downloading the hand model...
  curl -sSL -o hand_landmarker.task https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task
)
start "" http://localhost:5000/game
rem starts with the camera off - switch it on with "📷 카메라" on the page
python app.py --no-robot --host 127.0.0.1 --port 5000 --camera-off
