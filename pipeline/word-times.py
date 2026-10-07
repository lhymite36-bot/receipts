#!/usr/bin/env python3
"""Word onsets for a voice track (local faster-whisper, no API quota). Prints JSON [{w, s, e, p}] (seconds into the file).
Usage: word-times.py <voice.wav> [model=base.en]"""
import json, subprocess, sys
import numpy as np
from faster_whisper import WhisperModel
wav = sys.argv[1]; name = sys.argv[2] if len(sys.argv) > 2 else 'base.en'
m = WhisperModel(name, device='cpu', compute_type='int8')
pcm = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', wav, '-ac', '1', '-ar', '16000', '-f', 's16le', '-'], capture_output=True, check=True).stdout
audio = np.frombuffer(pcm, np.int16).astype(np.float32) / 32768  # decoded by ffmpeg (PyAV versions differ)
segs, _ = m.transcribe(audio, language='en', word_timestamps=True, beam_size=5, vad_filter=False, condition_on_previous_text=False)
out = [{'w': w.word.strip(), 's': round(w.start, 3), 'e': round(w.end, 3), 'p': round(w.probability, 3)} for s in segs for w in (s.words or [])]
print(json.dumps(out))
