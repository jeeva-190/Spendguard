"""Generate the voice-over for the demo video with Kokoro (open-source TTS, Apache-2.0).

Setup (one time):
  pip install kokoro-onnx soundfile
  download kokoro-v1.0.onnx and voices-v1.0.bin from
  https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0

Usage:
  python scripts/make-voice.py <folder-with-model-files> [voice]
Writes demo-video/voice/<id>.wav and demo-video/voice/durations.json,
which `npm run record:demo` uses to time the video to the voice.
"""
import json, os, sys
import soundfile as sf
from kokoro_onnx import Kokoro

root = os.path.join(os.path.dirname(__file__), "..")
model_dir = sys.argv[1] if len(sys.argv) > 1 else "."
voice = sys.argv[2] if len(sys.argv) > 2 else "af_heart"
out = os.path.join(root, "demo-video", "voice")
os.makedirs(out, exist_ok=True)

k = Kokoro(os.path.join(model_dir, "kokoro-v1.0.onnx"), os.path.join(model_dir, "voices-v1.0.bin"))
lines = json.load(open(os.path.join(root, "scripts", "narration.json")))
durations = {}
for line in lines:
    samples, rate = k.create(line["say"], voice=voice, speed=1.0, lang="en-us")
    sf.write(os.path.join(out, f"{line['id']}.wav"), samples, rate)
    durations[line["id"]] = round(len(samples) / rate, 3)
    print(f"{line['id']:10s} {durations[line['id']]:5.2f}s")
json.dump(durations, open(os.path.join(out, "durations.json"), "w"), indent=1)
print(f"Total speech: {sum(durations.values()):.1f}s")
