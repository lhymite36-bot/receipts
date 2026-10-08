#!/usr/bin/env python3
"""Speaker (timbre / formant / gender) embeddings for the Story voice-distinctness check. Local, no API quota.
Model: WeSpeaker ResNet34-LM trained on VoxCeleb (ONNX, 256-d). It encodes who is speaking (vocal-tract length / formants,
voice quality, gender), largely independent of the words and of the pitch of a particular read.
Usage: speaker-embed.py <json>   json = {"who": ["a.wav", "b.wav", ...], ...}   (16-bit wavs, any rate)
Prints JSON {"model": ..., "who": {name: {"sec": s}}, "pairs": [{"a","b","cos"}], "within": {name: min cos between its lines}}.
Each character's lines are concatenated (0.15 s gaps) before embedding; 'within' compares single lines of one character."""
import json, os, subprocess, sys, itertools
import numpy as np
import onnxruntime as ort
MODEL = os.environ.get('SPK_MODEL', os.path.expanduser('~/.cache/receipts-models/voxceleb_resnet34_LM.onnx'))
URL = 'https://huggingface.co/Wespeaker/wespeaker-voxceleb-resnet34-LM/resolve/main/voxceleb_resnet34_LM.onnx'
SR = 16000
def load(path):
    pcm = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', path, '-ac', '1', '-ar', str(SR), '-f', 's16le', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(pcm, np.int16).astype(np.float64)  # kaldi convention: int16 scale
def trim(x):  # drop leading / trailing silence (keeps the embedding on speech)
    hop = SR // 100; fr = np.array([np.sqrt(np.mean(x[i:i + hop] ** 2)) for i in range(0, max(1, len(x) - hop), hop)])
    if not len(fr) or fr.max() <= 0: return x
    on = np.where(fr > fr.max() * 0.03)[0]
    return x[max(0, on[0] * hop - hop * 5): min(len(x), (on[-1] + 6) * hop)] if len(on) else x
def mel_banks(n_fft, n_mel=80, lo=20.0, hi=SR / 2):
    mel = lambda f: 1127.0 * np.log(1 + f / 700.0)
    m_lo, m_hi = mel(lo), mel(hi); d = (m_hi - m_lo) / (n_mel + 1)
    fm = mel(np.arange(n_fft // 2) * SR / n_fft)
    W = np.zeros((n_mel, n_fft // 2 + 1))
    for b in range(n_mel):
        l, c, r = m_lo + b * d, m_lo + (b + 1) * d, m_lo + (b + 2) * d
        up = (fm - l) / (c - l); dn = (r - fm) / (r - c)
        W[b, :n_fft // 2] = np.maximum(0, np.minimum(up, dn))
    return W
def fbank(x):  # Kaldi-compatible fbank: 25 ms povey window, 10 ms shift, 0.97 pre-emphasis, 80 mel bins, no dither
    fl, fs, n_fft = 400, 160, 512
    n = 1 + (len(x) - fl) // fs
    if n < 1: x = np.pad(x, (0, fl - len(x))); n = 1
    idx = np.arange(fl)[None, :] + fs * np.arange(n)[:, None]; F = x[idx].copy()
    F -= F.mean(1, keepdims=True)
    F[:, 1:] -= 0.97 * F[:, :-1]; F[:, 0] -= 0.97 * F[:, 0]
    F *= (0.5 - 0.5 * np.cos(2 * np.pi * np.arange(fl) / (fl - 1))) ** 0.85
    P = np.abs(np.fft.rfft(F, n_fft)) ** 2
    E = np.log(np.maximum(P @ mel_banks(n_fft).T, np.finfo(np.float32).eps))
    return (E - E.mean(0, keepdims=True)).astype(np.float32)  # CMN
_sess = None
def embed(x):
    global _sess
    if _sess is None: _sess = ort.InferenceSession(MODEL, providers=['CPUExecutionProvider'])
    e = _sess.run(None, {'feats': fbank(x)[None]})[0][0]
    return e / (np.linalg.norm(e) + 1e-9)
def main():
    if not os.path.exists(MODEL):
        os.makedirs(os.path.dirname(MODEL), exist_ok=True); subprocess.run(['curl', '-sfL', '-o', MODEL, URL], check=True)
    spec = json.load(open(sys.argv[1])) if len(sys.argv) > 1 else json.load(sys.stdin)
    gap = np.zeros(int(0.15 * SR)); emb = {}; info = {}; within = {}
    for who, files in spec.items():
        xs = [trim(load(f)) for f in files]
        cat = np.concatenate([np.concatenate([x, gap]) for x in xs])
        emb[who] = embed(cat); info[who] = {'sec': round(len(cat) / SR, 2), 'lines': len(xs)}
        if len(xs) > 1: es = [embed(x) for x in xs]; within[who] = round(float(min(a @ b for a, b in itertools.combinations(es, 2))), 3)
    pairs = [{'a': a, 'b': b, 'cos': round(float(emb[a] @ emb[b]), 3)} for a, b in itertools.combinations(emb, 2)]
    print(json.dumps({'model': os.path.basename(MODEL), 'who': info, 'pairs': pairs, 'within': within}))
if __name__ == '__main__': main()
