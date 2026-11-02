@echo off
rem Open the interactive presentation on this PC (robot program + slides at http://localhost:5000/ppt/).
chcp 65001 >nul
cd /d "%~dp0"
if not exist hand_landmarker.task (
  curl -sSL -o hand_landmarker.task https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task
)
start "" http://localhost:5000/ppt/
python app.py --no-robot --host 127.0.0.1 --port 5000 --camera-off
