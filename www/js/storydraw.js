/* Receipts "Story" mode renderer: suspense-first stick-figure shots on the app canvas (1080x1920, frame-exact draw(t)).
   STYLE LOCK: circle heads, dot/oval eyes, line bodies, mitt hands, bold even outlines, flat colour from the story's 3-colour
   script, designed simple backgrounds per location anchor, emotion symbols (sweat, heart, ?, sparkle, !). Looks are locked per
   character for every shot; motion is small (breathing, blink, one action per shot, the stress tell growing with tension).
   Camera: hold / slow push-in / slight pan / snap cut. Accent colour only in accent-allowed panels; a short accent dip only at
   the snap; 1.5 s end card on the accent colour; lower-third captions that never sit over faces (layout is recorded for QA). */
(function () {
  'use strict';
  const VTS = (window.VTS = window.VTS || {});
  const W = 1080; const H = 1920; const TAU = Math.PI * 2;
  const FONT = 'Montserrat, "Arial Black", "Roboto", sans-serif';
  const INK = '#1F1B2D'; const CREAM = '#FFF9F0'; const OUT = 7; // bold even outline
  const SAFE = { top: 210, bottom: 1560, side: 70 }; // Reels/TikTok UI-safe area; captions live in the lower third inside it
  const CAP_TOP = 1318; // lower third starts here; every face is kept above it by the camera rules
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ease = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  const lerp = (a, b, k) => a + (b - a) * k;
  function hex2rgb(h) { const n = parseInt(String(h).slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
  function mix(a, b, k) { const A = hex2rgb(a); const B = hex2rgb(b); return '#' + A.map((v, i) => Math.round(lerp(v, B[i], k)).toString(16).padStart(2, '0')).join(''); }
  const tint = (h, k) => mix(h, '#FFFFFF', k); const shade = (h, k) => mix(h, '#1F1B2D', k);
  const lum = (h) => { const [r, g, b] = hex2rgb(h); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };
  function hash(i) { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
  function rr(ctx, x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  // filled + outlined shapes (bold even outline everywhere)
  function fillOut(ctx, fill, lw) { if (fill) { ctx.fillStyle = fill; ctx.fill(); } ctx.lineWidth = lw || OUT; ctx.strokeStyle = INK; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke(); }
  function box(ctx, x, y, w, h, fill, r) { rr(ctx, x, y, w, h, r == null ? 10 : r); fillOut(ctx, fill); }
  function circ(ctx, x, y, r, fill, lw) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); fillOut(ctx, fill, lw); }
  function line(ctx, pts, color, w, outline) {
    const path = () => { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); };
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (outline !== false) { path(); ctx.strokeStyle = INK; ctx.lineWidth = w + OUT * 1.6; ctx.stroke(); }
    path(); ctx.strokeStyle = color; ctx.lineWidth = w; ctx.stroke();
  }

  // ---------------- palette ----------------
  function paletteOf(plan) {
    const cs = plan.colorScript; const D = cs.dominant.hex; const S = cs.support.hex; const A = cs.accent.hex;
    // big props (counter, benches) are drawn in the support colour; when a character wears it, props go lighter so the body reads
    const hx = (h) => { const n = parseInt(String(h).slice(1), 16); const r = (n >> 16) / 255; const g = ((n >> 8) & 255) / 255; const b = (n & 255) / 255; const mx = Math.max(r, g, b); const mn = Math.min(r, g, b); const l = (mx + mn) / 2; let hh = 0; if (mx !== mn) { const d = mx - mn; hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; } return { h: (hh * 60 + 360) % 360, l }; };
    const clash = (plan.characters || []).some((c) => { if (!/^#[0-9a-f]{6}$/i.test(c.top || '')) return false; const a = hx(c.top); const b = hx(S); return Math.min(Math.abs(a.h - b.h), 360 - Math.abs(a.h - b.h)) < 22 && Math.abs(a.l - b.l) < 0.16; });
    const prop = clash ? tint(S, 0.5) : S;
    return { D, S, A, wall: tint(D, 0.42), wall2: tint(D, 0.62), floor: tint(S, 0.62), floor2: tint(S, 0.45), prop, prop2: tint(S, clash ? 0.7 : 0.3), prop3: shade(S, 0.25), propD: shade(D, 0.12), light: tint(D, 0.8), glow: tint(S, 0.75) };
  }
  const SKY = { morning: ['#FFE9B8', '#BFE6FF'], day: ['#BDE6FF', '#E3F6FF'], 'golden hour': ['#FFC48C', '#FFE3B3'], evening: ['#F7A6C4', '#B9A3E3'], night: ['#3B3A8F', '#6C63C7'] };

  // ---------------- backgrounds (designed, readable, per location anchor) ----------------
  // world space = the wide shot (1080x1920). Floor line at FLOOR; figures stand at FEET.
  const FLOOR = 1150; const FEET = 1250;
  function windowAt(ctx, x, y, w, h, tod, P, curtains) {
    const s = SKY[tod] || SKY.day; const g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, s[0]); g.addColorStop(1, s[1]);
    box(ctx, x, y, w, h, g, 14);
    if (tod === 'night') { ctx.fillStyle = '#FFF6C7'; for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(x + 20 + hash(i + x) * (w - 40), y + 20 + hash(i + 9 + y) * (h * 0.6), 3.5, 0, TAU); ctx.fill(); } circ(ctx, x + w * 0.75, y + h * 0.28, 22, '#FFF6C7', 4); }
    else circ(ctx, x + w * 0.76, y + h * 0.3, 24, tod === 'golden hour' || tod === 'evening' ? '#FFD27A' : '#FFF3B0', 4);
    ctx.beginPath(); ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w / 2, y + h); ctx.moveTo(x, y + h / 2); ctx.lineTo(x + w, y + h / 2); ctx.lineWidth = 6; ctx.strokeStyle = INK; ctx.stroke();
    if (curtains) { box(ctx, x - 26, y - 12, 44, h + 30, P.prop2, 18); box(ctx, x + w - 18, y - 12, 44, h + 30, P.prop2, 18); }
  }
  function plant(ctx, x, y, s, P) { s = s || 1; box(ctx, x - 34 * s, y - 60 * s, 68 * s, 60 * s, P.prop, 10); [[-30, -110, 28], [0, -140, 32], [30, -108, 28], [-12, -90, 24], [16, -85, 24]].forEach(([dx, dy, r]) => circ(ctx, x + dx * s, y + dy * s, r * s, '#5BC27A', 5)); }
  function lamp(ctx, x, y, P, on) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, y - 40); ctx.lineWidth = 5; ctx.strokeStyle = INK; ctx.stroke(); ctx.beginPath(); ctx.moveTo(x - 50, y); ctx.lineTo(x - 26, y - 44); ctx.lineTo(x + 26, y - 44); ctx.lineTo(x + 50, y); ctx.closePath(); fillOut(ctx, P.prop); if (on !== false) { const g = ctx.createRadialGradient(x, y + 30, 10, x, y + 120, 260); g.addColorStop(0, 'rgba(255,244,200,0.55)'); g.addColorStop(1, 'rgba(255,244,200,0)'); ctx.fillStyle = g; ctx.fillRect(x - 280, y, 560, 420); } }
  function clockAt(ctx, x, y, r, t) { circ(ctx, x, y, r, CREAM, 6); const a = (t || 0) * TAU / 6; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.sin(a) * r * 0.72, y - Math.cos(a) * r * 0.72); ctx.moveTo(x, y); ctx.lineTo(x + r * 0.42, y); ctx.lineWidth = 6; ctx.strokeStyle = INK; ctx.lineCap = 'round'; ctx.stroke(); }
  function door(ctx, x, y, w, h, P, open) { box(ctx, x - 8, y - 8, w + 16, h + 8, P.propD, 6); ctx.fillStyle = shade(P.D, 0.55); ctx.fillRect(x, y, w, h); const ow = w * (1 - 0.75 * clamp(open || 0, 0, 1)); box(ctx, x, y, ow, h, P.prop2, 4); circ(ctx, x + ow - 22, y + h * 0.55, 8, '#FFD27A', 4); }
  function shelf(ctx, x, y, w, rows, P, seed) { box(ctx, x, y, w, rows * 110 + 20, P.prop3, 8); for (let r = 0; r < rows; r++) { const yy = y + 20 + r * 110; ctx.fillStyle = tint(P.S, 0.55); ctx.fillRect(x + 12, yy + 86, w - 24, 8); for (let k = 0; k < Math.floor((w - 30) / 40); k++) { const c = [P.D, tint(P.S, 0.2), '#FFD6A5', '#A0E7E5', '#FFAFCC', '#B5E48C'][Math.floor(hash(k + r * 7 + seed) * 6)]; const hh = 54 + hash(k * 3 + r + seed) * 28; box(ctx, x + 18 + k * 40, yy + 86 - hh, 32, hh, c, 6); } } }
  function table(ctx, x, y, w, P) { box(ctx, x - w / 2, y, w, 26, P.prop, 10); line(ctx, [[x, y + 26], [x, FEET - 6]], P.prop3, 12); box(ctx, x - 50, FEET - 14, 100, 16, P.prop3, 6); }
  function stool(ctx, x, P) { box(ctx, x - 52, FEET - 150, 104, 24, P.prop, 12); line(ctx, [[x - 34, FEET - 126], [x - 44, FEET]], P.prop3, 9); line(ctx, [[x + 34, FEET - 126], [x + 44, FEET]], P.prop3, 9); }
  function cup(ctx, x, y, s, P, sleeve) { s = s || 1; ctx.beginPath(); ctx.moveTo(x - 34 * s, y - 92 * s); ctx.lineTo(x + 34 * s, y - 92 * s); ctx.lineTo(x + 26 * s, y); ctx.lineTo(x - 26 * s, y); ctx.closePath(); fillOut(ctx, CREAM, OUT * Math.min(1.4, s)); box(ctx, x - 40 * s, y - 108 * s, 80 * s, 18 * s, tint(P.S, 0.4), 8 * s); ctx.beginPath(); ctx.moveTo(x - 31 * s, y - 64 * s); ctx.lineTo(x + 31 * s, y - 64 * s); ctx.lineTo(x + 28 * s, y - 34 * s); ctx.lineTo(x - 28 * s, y - 34 * s); ctx.closePath(); fillOut(ctx, sleeve || P.prop, OUT * Math.min(1.4, s)); }
  const BG = {
    'coffee shop': (ctx, P, L, t) => { windowAt(ctx, 70, 330, 300, 360, L.tod, P); plant(ctx, 220, 700, 0.8, P); box(ctx, 600, 300, 360, 250, '#2F5D62', 16); for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(640, 360 + i * 46); ctx.lineTo(640 + 120 + hash(i) * 150, 360 + i * 46); ctx.lineWidth = 7; ctx.strokeStyle = '#F4F1DE'; ctx.lineCap = 'round'; ctx.stroke(); } lamp(ctx, 470, 240, P); lamp(ctx, 830, 640, P, false);
      box(ctx, -40, 900, 1160, 250, P.prop, 8); box(ctx, -40, 880, 1160, 40, P.prop2, 8); box(ctx, 690, 760, 170, 130, tint(P.D, 0.1), 14); box(ctx, 715, 790, 120, 36, P.prop3, 8); line(ctx, [[745, 826], [745, 860]], INK, 6, false); line(ctx, [[805, 826], [805, 860]], INK, 6, false); cup(ctx, 940, 880, 0.55, P); cup(ctx, 1000, 880, 0.55, P); },
    kitchen: (ctx, P, L) => { windowAt(ctx, 380, 330, 320, 300, L.tod, P, true); box(ctx, 60, 520, 240, 630, CREAM, 20); line(ctx, [[260, 700], [260, 800]], INK, 8, false); [P.D, '#FFD6A5', P.prop].forEach((c, i) => circ(ctx, 120 + i * 50, 600 + (i % 2) * 40, 14, c, 4)); box(ctx, 330, 860, 760, 290, P.prop, 10); box(ctx, 330, 840, 760, 36, P.prop2, 8); box(ctx, 790, 760, 120, 80, CREAM, 18); ctx.beginPath(); ctx.arc(850, 760, 34, Math.PI, 0); fillOut(ctx, tint(P.S, 0.3)); box(ctx, 430, 760, 200, 80, tint(P.D, 0.2), 10); },
    bedroom: (ctx, P, L) => { windowAt(ctx, 600, 320, 320, 320, L.tod, P, true); box(ctx, 60, 820, 520, 260, P.prop2, 24); box(ctx, 60, 700, 70, 400, P.prop3, 14); box(ctx, 100, 840, 140, 70, CREAM, 30); box(ctx, 230, 860, 360, 220, tint(P.D, 0.15), 24); for (let i = 0; i < 3; i++) box(ctx, 260 + i * 110, 900, 70, 70, tint(P.S, 0.55), 12); box(ctx, 640, 900, 120, 250, P.prop, 10); lamp(ctx, 700, 780, P); box(ctx, 160, 360, 220, 260, tint(P.S, 0.6), 10); circ(ctx, 270, 470, 60, '#FFD6A5', 5); },
    'bathroom mirror': (ctx, P, L) => { for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) { ctx.fillStyle = (r + c) % 2 ? tint(P.D, 0.5) : tint(P.D, 0.6); ctx.fillRect(c * 130 - 40, 600 + r * 70, 130, 70); } circ(ctx, 540, 520, 230, tint(P.S, 0.8), 10); ctx.save(); ctx.beginPath(); ctx.arc(540, 520, 214, 0, TAU); ctx.clip(); ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(380, 300, 60, 500); ctx.fillRect(470, 300, 24, 500); ctx.restore(); box(ctx, 330, 860, 420, 120, CREAM, 30); box(ctx, 500, 800, 80, 70, tint(P.S, 0.2), 10); line(ctx, [[860, 620], [1040, 620]], P.prop3, 12); box(ctx, 880, 630, 120, 260, P.prop2, 12); },
    'living room': (ctx, P, L) => { windowAt(ctx, 640, 330, 300, 300, L.tod, P, true); box(ctx, 120, 360, 170, 130, tint(P.S, 0.5), 8); box(ctx, 320, 400, 130, 170, '#FFD6A5', 8); box(ctx, 60, 860, 640, 230, P.prop, 40); box(ctx, 90, 780, 580, 140, P.prop2, 40); box(ctx, 40, 820, 90, 260, P.prop3, 30); box(ctx, 640, 820, 90, 260, P.prop3, 30); line(ctx, [[880, 1150], [880, 700]], INK, 8, false); ctx.beginPath(); ctx.moveTo(820, 700); ctx.lineTo(850, 610); ctx.lineTo(910, 610); ctx.lineTo(940, 700); ctx.closePath(); fillOut(ctx, tint(P.D, 0.2)); plant(ctx, 1000, 1150, 0.9, P); },
    classroom: (ctx, P, L, t) => { box(ctx, 120, 320, 840, 380, '#2F6F62', 16); box(ctx, 120, 700, 840, 30, P.prop2, 6); for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(200, 400 + i * 80); ctx.quadraticCurveTo(400, 380 + i * 90, 560 + i * 60, 400 + i * 80); ctx.lineWidth = 7; ctx.strokeStyle = '#F4F1DE'; ctx.stroke(); } clockAt(ctx, 960, 250, 50, t); [[180, 960], [540, 960], [900, 960]].forEach(([x, y]) => { box(ctx, x - 130, y, 260, 30, P.prop, 8); line(ctx, [[x - 100, y + 30], [x - 100, FLOOR + 20]], P.prop3, 10); line(ctx, [[x + 100, y + 30], [x + 100, FLOOR + 20]], P.prop3, 10); }); },
    office: (ctx, P, L) => { box(ctx, 600, 320, 360, 340, SKY[L.tod] ? SKY[L.tod][1] : '#E3F6FF', 12); for (let i = 0; i < 8; i++) { ctx.fillStyle = tint(P.S, 0.35); ctx.fillRect(606, 330 + i * 40, 348, 18); } box(ctx, 80, 900, 560, 40, P.prop, 10); line(ctx, [[120, 940], [120, FLOOR + 30]], P.prop3, 12); line(ctx, [[600, 940], [600, FLOOR + 30]], P.prop3, 12); box(ctx, 220, 730, 240, 160, INK, 14); box(ctx, 236, 746, 208, 128, tint(P.S, 0.6), 8); line(ctx, [[340, 890], [340, 905]], INK, 14, false); plant(ctx, 900, 1150, 1.1, P); },
    'bus stop': (ctx, P, L, t, feat) => { const s = SKY[L.tod] || SKY.day; const g = ctx.createLinearGradient(0, 0, 0, FLOOR); g.addColorStop(0, s[0]); g.addColorStop(1, s[1]); ctx.fillStyle = g; ctx.fillRect(-1500, -1500, 4080, FLOOR + 1500); [[80, 520, 160], [300, 600, 120], [760, 480, 190], [960, 580, 130]].forEach(([x, y, w]) => box(ctx, x, y, w, FLOOR - y, tint(P.S, 0.35 + hash(x) * 0.2), 6)); box(ctx, 140, 640, 520, 30, P.prop, 8); line(ctx, [[160, 670], [160, FLOOR + 20]], P.prop3, 12); line(ctx, [[640, 670], [640, FLOOR + 20]], P.prop3, 12); box(ctx, 200, 960, 400, 26, P.prop2, 10); line(ctx, [[880, 400], [880, FLOOR + 30]], INK, 10, false); circ(ctx, 880, 400, 54, tint(P.D, 0.1), 7);
      if (feat === 'arriving bus') { const bx = 1180 - 260 * ease(((t || 0) % 6) / 6); box(ctx, bx, 700, 700, 420, '#FFC94A', 30); box(ctx, bx + 40, 760, 200, 140, '#BFE6FF', 12); } },
    'park bench': (ctx, P, L) => { const s = SKY[L.tod] || SKY.day; const g = ctx.createLinearGradient(0, 0, 0, FLOOR); g.addColorStop(0, s[0]); g.addColorStop(1, s[1]); ctx.fillStyle = g; ctx.fillRect(-1500, -1500, 4080, FLOOR + 1500); [[150, 620], [930, 560]].forEach(([x, y]) => { line(ctx, [[x, y + 100], [x, FLOOR + 10]], P.prop3, 26); circ(ctx, x, y, 150, '#6CCB86', 7); circ(ctx, x - 80, y + 60, 90, '#7FD99A', 6); }); line(ctx, [[760, 420], [760, FLOOR + 20]], INK, 10, false); circ(ctx, 760, 410, 40, '#FFF3B0', 6); box(ctx, 290, 930, 520, 40, P.prop, 12); box(ctx, 290, 860, 520, 36, P.prop, 12); line(ctx, [[330, 970], [330, FLOOR + 30]], P.prop3, 12); line(ctx, [[770, 970], [770, FLOOR + 30]], P.prop3, 12); },
    'grocery aisle': (ctx, P, L) => { shelf(ctx, -60, 360, 400, 7, P, 1); shelf(ctx, 740, 360, 400, 7, P, 5); box(ctx, 400, 230, 280, 90, tint(P.S, 0.2), 14); line(ctx, [[460, 0], [460, 230]], INK, 5, false); line(ctx, [[620, 0], [620, 230]], INK, 5, false); box(ctx, 430, 980, 220, 130, 'rgba(255,255,255,0.4)', 10); circ(ctx, 460, 1130, 18, INK, 3); circ(ctx, 620, 1130, 18, INK, 3); },
    gym: (ctx, P, L) => { box(ctx, 80, 330, 920, 420, tint(P.S, 0.78), 12); ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.fillRect(200, 340, 40, 400); ctx.fillRect(270, 340, 18, 400); box(ctx, 120, 880, 520, 30, P.prop3, 8); for (let i = 0; i < 5; i++) { circ(ctx, 170 + i * 100, 860, 24, P.prop, 5); } box(ctx, 840, 700, 140, 450, tint(P.S, 0.5), 18); box(ctx, 860, 600, 100, 110, '#BFE6FF', 30); },
    'restaurant booth': (ctx, P, L) => { lamp(ctx, 540, 380, P); box(ctx, 40, 640, 220, 520, P.prop, 40); box(ctx, 820, 640, 220, 520, P.prop, 40); box(ctx, 300, 880, 480, 34, P.prop2, 12); line(ctx, [[540, 914], [540, FLOOR + 30]], P.prop3, 16); box(ctx, 600, 800, 70, 80, CREAM, 8); windowAt(ctx, 330, 300, 420, 170, L.tod, P); },
    rooftop: (ctx, P, L) => { const s = SKY[L.tod] || SKY.evening; const g = ctx.createLinearGradient(0, 0, 0, FLOOR); g.addColorStop(0, s[0]); g.addColorStop(1, s[1]); ctx.fillStyle = g; ctx.fillRect(-1500, -1500, 4080, FLOOR + 1500); for (let i = 0; i < 9; i++) { const x = -60 + i * 140; const h = 200 + hash(i) * 300; box(ctx, x, 980 - h, 120, h + 40, tint(P.S, 0.3 + hash(i + 3) * 0.3), 6); for (let k = 0; k < 4; k++) { ctx.fillStyle = '#FFF3B0'; ctx.fillRect(x + 20 + (k % 2) * 50, 1000 - h + 30 + Math.floor(k / 2) * 60, 24, 30); } } ctx.beginPath(); ctx.moveTo(-40, 300); ctx.quadraticCurveTo(540, 420, 1120, 300); ctx.lineWidth = 4; ctx.strokeStyle = INK; ctx.stroke(); for (let i = 0; i < 11; i++) { const x = i * 108; const y = 300 + Math.sin((i / 10) * Math.PI) * 60; circ(ctx, x, y + 14, 12, ['#FFD27A', '#FFAFCC', '#A0E7E5'][i % 3], 4); } box(ctx, -40, 1000, 1160, 24, P.prop3, 6); for (let i = 0; i < 12; i++) line(ctx, [[i * 100, 1010], [i * 100, FLOOR]], P.prop3, 8, false); },
    hallway: (ctx, P, L, t, feat, open) => { [[60, 'A'], [420, 'B'], [780, 'C']].forEach(([x], i) => door(ctx, x, 520, 240, 630, P, i === 2 ? open : 0)); for (let i = 0; i < 3; i++) lamp(ctx, 180 + i * 360, 300, P); box(ctx, 200, 1180, 680, 120, tint(P.S, 0.4), 30); },
    car: (ctx, P, L) => { box(ctx, -60, 260, 1200, 560, (SKY[L.tod] || SKY.day)[1], 60); box(ctx, -60, 780, 1200, 500, P.prop, 30); circ(ctx, 300, 760, 150, null, 22); line(ctx, [[300, 760], [300, 900]], INK, 18, false); box(ctx, 620, 820, 300, 90, P.prop2, 16); },
    library: (ctx, P, L) => { shelf(ctx, 40, 300, 330, 7, P, 2); shelf(ctx, 710, 300, 330, 7, P, 9); box(ctx, 430, 320, 220, 90, CREAM, 12); line(ctx, [[470, 365], [610, 365]], INK, 8, false); lamp(ctx, 540, 640, P); box(ctx, 380, 920, 320, 30, P.prop, 10); line(ctx, [[540, 950], [540, FLOOR + 20]], P.prop3, 14); },
    subway: (ctx, P, L) => { box(ctx, -40, 300, 1160, 380, tint(P.S, 0.25), 20); for (let i = 0; i < 3; i++) box(ctx, 60 + i * 340, 360, 280, 240, shade(P.S, 0.35), 30); line(ctx, [[-40, 250], [1120, 250]], INK, 8, false); for (let i = 0; i < 6; i++) { line(ctx, [[90 + i * 180, 250], [90 + i * 180, 330]], INK, 5, false); circ(ctx, 90 + i * 180, 350, 22, null, 6); } box(ctx, -40, 880, 1160, 120, P.prop, 30); box(ctx, 380, 700, 320, 120, CREAM, 10); ctx.beginPath(); ctx.moveTo(410, 760); ctx.bezierCurveTo(480, 700, 560, 820, 670, 740); ctx.lineWidth = 8; ctx.strokeStyle = P.D; ctx.stroke(); },
    stairwell: (ctx, P, L) => { windowAt(ctx, 700, 280, 240, 300, L.tod, P); for (let i = 0; i < 8; i++) box(ctx, 80 + i * 70, 1150 - (i + 1) * 70, 1000, 70, i % 2 ? P.prop2 : tint(P.S, 0.45), 4); line(ctx, [[80, 1040], [660, 480]], P.prop3, 14); },
    elevator: (ctx, P, L, t, feat, open) => { box(ctx, 220, 360, 640, 790, tint(P.S, 0.55), 12); const o = clamp(open || 0, 0, 1) * 150; box(ctx, 240 - o, 380, 300, 770, tint(P.D, 0.25), 6); box(ctx, 540 + o, 380, 300, 770, tint(P.D, 0.25), 6); box(ctx, 900, 640, 90, 220, P.prop2, 14); for (let i = 0; i < 4; i++) circ(ctx, 945, 680 + i * 46, 14, i === 2 ? '#FFD27A' : CREAM, 4); box(ctx, 440, 270, 200, 70, INK, 12); },
    'party kitchen': (ctx, P, L) => { box(ctx, 60, 520, 230, 630, CREAM, 20); for (let i = 0; i < 9; i++) { const x = 330 + i * 80; ctx.beginPath(); ctx.moveTo(x, 300); ctx.lineTo(x + 40, 370); ctx.lineTo(x + 80, 300); ctx.closePath(); fillOut(ctx, [P.D, tint(P.S, 0.3), '#FFD6A5'][i % 3], 4); } box(ctx, 330, 880, 760, 270, P.prop, 10); box(ctx, 330, 860, 760, 34, P.prop2, 8); [[460, '#FFAFCC'], [560, '#A0E7E5'], [660, '#FFD6A5']].forEach(([x, c]) => circ(ctx, x, 820, 30, c, 5)); [[880, 420, '#FFAFCC'], [960, 470, '#A0E7E5'], [1010, 400, '#B5E48C']].forEach(([x, y, c]) => { line(ctx, [[x, y + 60], [x - 10, 860]], INK, 3, false); ctx.beginPath(); ctx.ellipse(x, y, 44, 54, 0, 0, TAU); fillOut(ctx, c, 5); }); },
    'waiting room': (ctx, P, L, t) => { clockAt(ctx, 540, 330, 70, t); box(ctx, 640, 760, 400, 390, P.prop, 14); box(ctx, 640, 740, 400, 40, P.prop2, 10); for (let i = 0; i < 3; i++) { const x = 80 + i * 170; box(ctx, x, 900, 140, 40, P.prop2, 12); box(ctx, x, 780, 140, 130, P.prop2, 20); line(ctx, [[x + 20, 940], [x + 20, FLOOR + 20]], P.prop3, 8); line(ctx, [[x + 120, 940], [x + 120, FLOOR + 20]], P.prop3, 8); } plant(ctx, 600, 1150, 0.8, P); },
    beach: (ctx, P, L) => { const s = SKY[L.tod] || SKY.day; const g = ctx.createLinearGradient(0, 0, 0, 900); g.addColorStop(0, s[0]); g.addColorStop(1, s[1]); ctx.fillStyle = g; ctx.fillRect(-1500, -1500, 4080, 2400); circ(ctx, 820, 330, 70, '#FFE066', 6); ctx.fillStyle = '#5FC3E4'; ctx.fillRect(-1500, 820, 4080, 330); ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 6; for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.moveTo(60 + i * 180, 900 + (i % 2) * 60); ctx.quadraticCurveTo(100 + i * 180, 880 + (i % 2) * 60, 140 + i * 180, 900 + (i % 2) * 60); ctx.stroke(); } line(ctx, [[250, 660], [250, FLOOR + 40]], INK, 10, false); ctx.beginPath(); ctx.moveTo(60, 700); ctx.quadraticCurveTo(250, 520, 440, 700); ctx.closePath(); fillOut(ctx, P.D); box(ctx, 780, 1060, 160, 90, '#FFE3A3', 10); },
  };
  function background(ctx, plan, P, locId, t, open) {
    const L = (plan.locations || []).find((l) => l.id === locId) || { id: locId, timeOfDay: 'day', suspenseFeature: '' };
    const tod = L.timeOfDay || 'day';
    // wall + floor (flat friendly colour; lighting is colour: a soft support-tint glow, no heavy shade)
    const g = ctx.createLinearGradient(0, 0, 0, FLOOR); g.addColorStop(0, P.wall2); g.addColorStop(1, P.wall);
    ctx.fillStyle = g; ctx.fillRect(-1500, -1500, 4080, FLOOR + 1500);
    const gl = ctx.createRadialGradient(540, 520, 60, 540, 620, 900); gl.addColorStop(0, 'rgba(255,255,255,0.35)'); gl.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = gl; ctx.fillRect(-1500, -1500, 4080, FLOOR + 1500);
    const fg = ctx.createLinearGradient(0, FLOOR, 0, 1920); fg.addColorStop(0, P.floor2); fg.addColorStop(1, P.floor); ctx.fillStyle = fg; ctx.fillRect(-1500, FLOOR, 4080, 2500);
    ctx.beginPath(); ctx.moveTo(-1500, FLOOR); ctx.lineTo(2580, FLOOR); ctx.lineWidth = OUT; ctx.strokeStyle = INK; ctx.stroke();
    (BG[locId] || BG['living room'])(ctx, P, { tod }, t, L.suspenseFeature, open);
  }

  // ---------------- clue objects ----------------
  function clueObject(ctx, kind, x, y, s, P, accent, label, t) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    const A = accent ? P.A : null; const hi = A || tint(P.S, 0.25);
    if (A) { const g = ctx.createRadialGradient(0, -60, 10, 0, -60, 190); g.addColorStop(0, hexA(A, 0.55)); g.addColorStop(1, hexA(A, 0)); ctx.fillStyle = g; ctx.fillRect(-200, -260, 400, 400); }
    const text = (str, yy, size, col) => { if (!str) return; ctx.font = `800 ${size}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = col || INK; ctx.fillText(str, 0, yy); };
    switch (kind) {
      case 'note': { ctx.rotate(-0.06); box(ctx, -95, -150, 190, 150, '#FFF4B8', 10); ctx.beginPath(); ctx.moveTo(-95, -150); ctx.lineTo(-60, -150); ctx.lineTo(-95, -118); ctx.closePath(); ctx.fillStyle = 'rgba(0,0,0,0.08)'; ctx.fill(); fitText(ctx, label || '…', 0, -75, 165, 42, A || INK); break; }
      case 'cup': cup(ctx, 0, 0, 1.6, P, A || P.prop); if (label) { ctx.save(); ctx.rotate(-0.08); box(ctx, -62, -128, 124, 70, '#FFF4B8', 8); fitText(ctx, label, 0, -93, 110, 26, A || INK); ctx.restore(); } break;
      case 'phone': { box(ctx, -60, -200, 120, 200, INK, 18); const glow = 0.6 + 0.4 * Math.sin((t || 0) * 5); box(ctx, -48, -186, 96, 166, A ? mix(A, '#FFFFFF', 0.3 * glow) : tint(P.S, 0.5 + 0.3 * glow), 10); if (label) fitText(ctx, label, 0, -110, 84, 22, INK); break; }
      case 'gift': case 'box': box(ctx, -90, -150, 180, 150, P.D, 10); box(ctx, -100, -170, 200, 40, tint(P.D, 0.2), 10); box(ctx, -14, -170, 28, 170, hi, 4); if (kind === 'gift') { ctx.beginPath(); ctx.ellipse(-30, -184, 30, 18, -0.4, 0, TAU); fillOut(ctx, hi, 5); ctx.beginPath(); ctx.ellipse(30, -184, 30, 18, 0.4, 0, TAU); fillOut(ctx, hi, 5); } break;
      case 'letter': box(ctx, -110, -140, 220, 140, CREAM, 8); ctx.beginPath(); ctx.moveTo(-110, -140); ctx.lineTo(0, -64); ctx.lineTo(110, -140); fillOut(ctx, null, 6); circ(ctx, 0, -64, 18, hi, 5); break;
      case 'key': circ(ctx, -50, -60, 36, '#FFD27A', 7); line(ctx, [[-14, -60], [90, -60], [90, -36]], '#FFD27A', 14); break;
      case 'book': box(ctx, -100, -60, 200, 60, P.D, 6); box(ctx, -100, -100, 200, 44, hi, 6); break;
      case 'cake': box(ctx, -110, -120, 220, 120, CREAM, 18); box(ctx, -110, -126, 220, 36, tint(P.D, 0.2), 16); for (let i = 0; i < 3; i++) { box(ctx, -50 + i * 50 - 6, -176, 12, 50, hi, 4); circ(ctx, -50 + i * 50, -186, 9, '#FFD27A', 3); } break;
      case 'flowers': [[-40, -180], [0, -200], [40, -176], [-18, -150], [22, -146]].forEach(([fx, fy], i) => { line(ctx, [[fx * 0.3, -40], [fx, fy]], '#5BC27A', 8); circ(ctx, fx, fy, 26, i % 2 ? hi : '#FFAFCC', 5); circ(ctx, fx, fy, 8, '#FFE066', 3); }); ctx.beginPath(); ctx.moveTo(-50, -60); ctx.lineTo(50, -60); ctx.lineTo(20, 0); ctx.lineTo(-20, 0); ctx.closePath(); fillOut(ctx, P.prop); break;
      case 'photo': box(ctx, -100, -160, 200, 160, CREAM, 8); box(ctx, -80, -140, 160, 110, tint(P.S, 0.5), 4); circ(ctx, -20, -90, 18, CREAM, 4); circ(ctx, 30, -90, 18, CREAM, 4); break;
      case 'sign': case 'banner': line(ctx, [[0, 0], [0, -120]], INK, 10, false); box(ctx, -150, -240, 300, 130, hi, 14); fitText(ctx, label || '', 0, -175, 270, 46, lum(hi) < 0.45 ? '#FFFFFF' : INK); break;
      case 'balloon': line(ctx, [[0, 0], [0, -120]], INK, 4, false); ctx.beginPath(); ctx.ellipse(0, -190, 70, 84, 0, 0, TAU); fillOut(ctx, hi); break;
      case 'ticket': box(ctx, -110, -90, 220, 90, hi, 10); fitText(ctx, label || 'ADMIT ONE', 0, -45, 190, 30, INK); break;
      case 'ring': box(ctx, -60, -80, 120, 80, P.D, 14); circ(ctx, 0, -100, 30, null, 9); circ(ctx, 0, -132, 12, '#BFE6FF', 4); break;
      case 'bag': box(ctx, -80, -130, 160, 130, P.prop, 14); ctx.beginPath(); ctx.arc(0, -130, 40, Math.PI, 0); ctx.lineWidth = 10; ctx.strokeStyle = INK; ctx.stroke(); break;
      case 'umbrella': ctx.beginPath(); ctx.arc(0, -120, 110, Math.PI, 0); ctx.closePath(); fillOut(ctx, hi); line(ctx, [[0, -120], [0, 0], [-20, 10]], INK, 8, false); break;
      case 'plant': plant(ctx, 0, 0, 1.1, P); break;
      case 'kitten': case 'puppy': { const col = kind === 'kitten' ? '#FFB37A' : '#F5D7A1'; ctx.beginPath(); ctx.ellipse(10, -50, 80, 50, 0, 0, TAU); fillOut(ctx, col); circ(ctx, -60, -110, 52, col); if (kind === 'kitten') { ctx.beginPath(); ctx.moveTo(-100, -140); ctx.lineTo(-92, -190); ctx.lineTo(-70, -156); ctx.closePath(); fillOut(ctx, col, 5); ctx.beginPath(); ctx.moveTo(-50, -158); ctx.lineTo(-28, -192); ctx.lineTo(-18, -142); ctx.closePath(); fillOut(ctx, col, 5); } else { ctx.beginPath(); ctx.ellipse(-104, -110, 18, 34, 0.3, 0, TAU); fillOut(ctx, tint(col, -0.1) || col, 5); ctx.beginPath(); ctx.ellipse(-16, -110, 18, 34, -0.3, 0, TAU); fillOut(ctx, col, 5); } ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(-76, -114, 7, 0, TAU); ctx.arc(-44, -114, 7, 0, TAU); ctx.fill(); ctx.beginPath(); ctx.arc(-60, -98, 6, 0, Math.PI); ctx.lineWidth = 4; ctx.stroke(); line(ctx, [[86, -60], [120, -110 + Math.sin((t || 0) * 6) * 10]], col, 12); break; }
      case 'door': door(ctx, -120, -400, 240, 400, P, 0.3); break;
      case 'lamp': lamp(ctx, 0, -60, P); break;
      case 'clock': clockAt(ctx, 0, -90, 80, t); break;
      default: break;
    }
    ctx.restore();
  }
  function hexA(h, a) { const [r, g, b] = hex2rgb(h); return `rgba(${r},${g},${b},${a})`; }
  function fitText(ctx, s, x, y, maxW, size, col) { let sz = size; ctx.font = `800 ${sz}px ${FONT}`; const ws = String(s).split(/\s+/); let lines = [String(s)]; if (ctx.measureText(s).width > maxW && ws.length > 1) { const h = Math.ceil(ws.length / 2); lines = [ws.slice(0, h).join(' '), ws.slice(h).join(' ')]; } while (sz > 12 && lines.some((l) => { ctx.font = `800 ${sz}px ${FONT}`; return ctx.measureText(l).width > maxW; })) sz -= 2; ctx.font = `800 ${sz}px ${FONT}`; ctx.fillStyle = col || INK; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; lines.forEach((l, i) => ctx.fillText(l, x, y + (i - (lines.length - 1) / 2) * sz * 1.08)); }

  // ---------------- the stick figure (locked look) ----------------
  // c: locked character; st: stage entry; o: { t, k (tell 0..1), motion, mp (motion progress 0..1), P, accent, back }
  const HR = 58; const NECK = 26; const TORSO = 150; const LEG = 152; const ARM = 118;
  // POSE LIBRARY: [elbow, hand] offsets from the neck point for the arm on the facing side (f) and the other arm (a; same as f when
  // omitted); x is outward for that arm's side. Upper arm + forearm ~ ARM. 'idle' (relaxed, arms down) is the default; there is no
  // arms-straight-out (T) pose: 'freeze' maps to 'tense' (arms stiff at the sides).
  const POSE_ARMS = {
    idle: { f: [[34, 74], [40, 130]] },
    tense: { f: [[28, 76], [30, 134]] },
    back: { f: [[30, 74], [34, 130]] },
    hips: { f: [[66, 66], [30, 118]] },
    cup: { f: [[40, 78], [84, 66]], a: [[34, 74], [40, 130]] },
    'grip-cup': { f: [[42, 86], [17, 72]] },
    reading: { f: [[42, 86], [22, 66]] },
    phone: { f: [[38, 80], [60, 40]], a: [[34, 74], [40, 130]] },
    point: { f: [[62, 40], [118, 14]], a: [[34, 74], [40, 130]] },
    shrug: { f: [[42, 66], [66, 36]] },
    startled: { f: [[52, 62], [58, 0]] },
    'hand-chest': { f: [[44, 80], [4, 58]], a: [[34, 74], [40, 130]] },
    wave: { f: [[66, 6], [80, -52]], a: [[34, 74], [40, 130]] },
    cheer: { f: [[54, -20], [72, -78]] },
    reach: { f: [[60, 54], [116, 60]], a: [[34, 74], [40, 130]] },
    hide: { f: [[48, 30], [14, -74]] },
    sit: { f: [[34, 74], [62, 124]] },
  };
  // a held prop at the hand anchor; returns the prop's grip point (must coincide with the hand anchor: checked by final QA)
  const CUP_S = 0.62; const NOTE_S = 0.5;
  function drawHeld(ctx, held, at, fwd, o, P, t) {
    const [ax, ay] = at; const k = held.kind;
    if (k === 'cup') { cup(ctx, ax, ay + 49 * CUP_S, CUP_S, P, held.accent ? P.A : P.prop); if (held.label) { ctx.save(); ctx.translate(ax, ay - 40 * CUP_S); ctx.rotate(-0.08); box(ctx, -38, -22, 76, 40, '#FFF4B8', 6); fitText(ctx, held.label, 0, -2, 66, 18, held.accent ? P.A : INK); ctx.restore(); } const base = ay + 49 * CUP_S; return [ax, base - 49 * CUP_S]; }
    if (k === 'phone') { box(ctx, ax - 18, ay - 44, 36, 58, INK, 7); const gl = 0.5 + 0.5 * Math.sin((t || 0) * 6); box(ctx, ax - 12, ay - 38, 24, 40, o.motion === 'phone-light' ? mix(o.accent ? P.A : tint(P.S, 0.5), '#FFFFFF', gl * 0.4) : tint(P.S, 0.6), 4); return [ax, ay]; }
    // paper-like clues (note, letter, photo, ticket, book): held from below with both hands, label facing the camera
    clueObject(ctx, k, ax, ay + 12, NOTE_S, P, !!held.accent, held.label || '', t); return [ax, ay];
  }
  function figure(ctx, c, st, x, o) {
    const P = o.P; const t = o.t; const face = st.facing; const dir = face === 'left' ? -1 : face === 'right' ? 1 : 0; const back = face === 'back';
    const pose = st.pose; const sit = pose === 'sit'; const hide = pose === 'hide';
    let feet = FEET; const breath = Math.sin(t * TAU * 0.28 + x) * 2.2;
    let hop = 0; if (o.motion === 'jump') hop = Math.max(0, Math.sin(clamp((o.mp - 0.35) / 0.4, 0, 1) * Math.PI)) * 46;
    if (o.motion === 'step') x += 34 * ease(o.mp) * (dir || 1);
    const crouch = hide ? 0.82 : 1;
    const hip = [x, feet - (sit ? 150 : LEG * crouch) - hop];
    let lean = pose === 'lean' ? 0.16 * (dir || 1) : 0; if (o.motion === 'lean') lean += 0.1 * ease(o.mp) * (dir || 1);
    const neck = [hip[0] + Math.sin(lean) * TORSO, hip[1] - Math.cos(lean) * TORSO * crouch + breath];
    let hx = neck[0]; let hy = neck[1] - NECK - HR;
    let look = dir; if (o.motion === 'head-turn') look = lerp(dir === 0 ? -0.6 : -dir * 0.3, dir === 0 ? 0.9 : dir, ease(o.mp)); if (pose === 'turn') look = dir || 1;
    hx += look * 8;
    // stress tell (bigger as tension rises; none at the snap)
    const k = o.k || 0; const tell = c.stressTell; let tapLift = 0; let glance = 0; let grip = false; let phone = false; let shake = 0;
    if (k > 0) { if (tell === 'tap') tapLift = Math.max(0, Math.sin(t * TAU * (2 + 2 * k))) * 10 * k; if (tell === 'glance') glance = Math.sin(t * TAU * (0.5 + k)) > 0.6 ? 1 : Math.sin(t * TAU * (0.5 + k)) < -0.75 ? -1 : 0; if (tell === 'grip') { grip = true; shake = Math.sin(t * 60) * 1.6 * k; } if (tell === 'phone check') phone = Math.sin(t * TAU * 0.35) > 0.1 && k > 0.35; }
    if (o.motion === 'look-up') hy -= 6 * ease(o.mp);
    // legs
    const legCol = c.bottom; const shoe = INK;
    if (sit) { line(ctx, [[hip[0], hip[1]], [hip[0] + (dir || 1) * 90, hip[1] + 6], [hip[0] + (dir || 1) * 96, feet - 6]], legCol, 14); line(ctx, [[hip[0] - 12, hip[1]], [hip[0] - 12 + (dir || 1) * 84, hip[1] + 10], [hip[0] - 12 + (dir || 1) * 84, feet - 6]], legCol, 14); }
    else {
      const sw = pose === 'walk' ? Math.sin(t * TAU * 0.9) * 0.18 : 0; const spread = pose === 'freeze' || pose === 'cheer' ? 26 : 18;
      line(ctx, [[hip[0], hip[1]], [hip[0] - spread + Math.sin(sw) * LEG, feet - hop - 6]], legCol, 14);
      line(ctx, [[hip[0], hip[1]], [hip[0] + spread - Math.sin(sw) * LEG, feet - hop - 6 - tapLift]], legCol, 14);
      ctx.beginPath(); ctx.ellipse(hip[0] - spread + Math.sin(sw) * LEG - 6, feet - hop - 2, 18, 10, 0, 0, TAU); ctx.fillStyle = shoe; ctx.fill();
      ctx.beginPath(); ctx.ellipse(hip[0] + spread - Math.sin(sw) * LEG + 6, feet - hop - 2 - tapLift, 18, 10, 0, 0, TAU); ctx.fill();
      if (tapLift > 6) { ctx.strokeStyle = INK; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(hip[0] + spread + 40, feet - 30); ctx.lineTo(hip[0] + spread + 56, feet - 40); ctx.moveTo(hip[0] + spread + 42, feet - 12); ctx.lineTo(hip[0] + spread + 60, feet - 14); ctx.stroke(); }
    }
    // backpack behind the torso
    if (c.item === 'backpack') box(ctx, neck[0] - (dir || 1) * 58 - 30, neck[1] + 20, 60, 100, tint(c.top, -0.0) && shade(c.top, 0.25), 14);
    // torso: a thick line in the locked top colour
    line(ctx, [[neck[0], neck[1] + 6], [hip[0], hip[1]]], CREAM, 40 + OUT * 1.6 + 12, false); // sticker rim: reads on any wall/counter
    line(ctx, [[neck[0], neck[1] + 6], [hip[0], hip[1]]], c.top, 40);
    if (c.item === 'apron') { rr(ctx, neck[0] - 26, neck[1] + 40, 52, TORSO - 20, 10); fillOut(ctx, CREAM, 5); }
    if (c.item === 'tie') { ctx.beginPath(); ctx.moveTo(neck[0] - 8, neck[1] + 12); ctx.lineTo(neck[0] + 8, neck[1] + 12); ctx.lineTo(neck[0] + 10, neck[1] + 80); ctx.lineTo(neck[0], neck[1] + 96); ctx.lineTo(neck[0] - 10, neck[1] + 80); ctx.closePath(); fillOut(ctx, shade(c.bottom, 0.1), 4); }
    if (c.item === 'badge' || c.item === 'necklace') circ(ctx, neck[0] + (c.item === 'badge' ? 12 : 0), neck[1] + 40, 9, '#FFD27A', 4);
    // arms from the pose library (+ one action in motion). Small motion only: the hands drift with the breath. Held props are
    // drawn AT the hand anchor (after the arm, before the mitt), so they move with the hand and can never float.
    const fwd = dir || 1; let key = POSE_ARMS[o.arms] ? o.arms : 'idle';
    if (grip && key === 'idle') key = 'tense';
    let held = o.held || null;
    if ((phone || o.motion === 'phone-light') && !held && (key === 'idle' || key === 'tense' || key === 'back')) { key = 'phone'; held = { kind: 'phone' }; }
    const shUp = key === 'shrug' ? -8 : 0; const def = POSE_ARMS[key]; const idleDef = POSE_ARMS.idle;
    let fOff = def.f.map((q) => q.slice()); let aOff = (def.a || def.f).map((q) => q.slice());
    // one action in motion: a reach eases out from relaxed arms; a holding pose lifts the prop a little (e.g. lifting the mug)
    const mk = ease(o.mp || 0);
    if (o.motion === 'reach') {
      if (held) { fOff[1][1] += 26 * (1 - mk); fOff[0][1] += 14 * (1 - mk); if (def.a === undefined) { aOff[1][1] += 26 * (1 - mk); aOff[0][1] += 14 * (1 - mk); } }
      else { const tgt = key === 'idle' || key === 'tense' ? POSE_ARMS.reach : def; fOff = idleDef.f.map((q, k) => [lerp(q[0], tgt.f[k][0], mk), lerp(q[1], tgt.f[k][1], mk)]); key = key === 'idle' || key === 'tense' ? 'reach' : key; }
    }
    if (key === 'wave') { fOff[1][0] += Math.sin(t * TAU * 1.6) * 12; fOff[1][1] += Math.abs(Math.cos(t * TAU * 1.6)) * 4; }
    const drift = Math.sin(t * TAU * 0.28 + x) * 1.6; const drift2 = Math.sin(t * TAU * 0.19 + x * 0.37) * 1.4;
    const shF = [neck[0] + 16 * fwd, neck[1] + 18 + shUp]; const shA = [neck[0] - 16 * fwd, neck[1] + 18 + shUp];
    const place = (q, side, k) => [neck[0] + q[0] * side + (k ? drift2 * side * 0.6 + shake : 0), neck[1] + q[1] + shUp + (k ? drift : drift * 0.5)];
    const EF = place(fOff[0], fwd, 0); const HF = place(fOff[1], fwd, 1); const EA = place(aOff[0], -fwd, 0); const HA = place(aOff[1], -fwd, 1);
    if (key === 'grip-cup' || key === 'reading') { HA[0] = HF[0] - 2 * (HF[0] - neck[0]) + 0; HA[1] = HF[1]; } // both hands on the same prop
    line(ctx, [shA, EA, HA], c.top, 13); line(ctx, [shF, EF, HF], c.top, 13);
    if (c.item === 'watch') box(ctx, HA[0] - 9, HA[1] - 26, 18, 14, '#FFD27A', 4);
    let heldInfo = null;
    if (held) {
      const two = key === 'grip-cup' || key === 'reading'; const at = two ? [(HF[0] + HA[0]) / 2, (HF[1] + HA[1]) / 2] : HF.slice();
      heldInfo = { kind: held.kind, hand: two ? 'both' : 'fwd', at, grip: drawHeld(ctx, held, at, fwd, o, P, t) };
    }
    if (c.item === 'book' && !held && key !== 'cheer' && key !== 'wave') box(ctx, HA[0] - 30, HA[1] - 30, 60, 40, P.D, 6);
    if (c.item === 'umbrella' && !(held && (key === 'grip-cup' || key === 'reading'))) line(ctx, [[HA[0], HA[1]], [HA[0] + 6, HA[1] + 120]], shade(c.top, 0.2), 12);
    circ(ctx, HA[0], HA[1], 13, CREAM, 6); circ(ctx, HF[0], HF[1], 13, CREAM, 6); // mitt hands, in front of the prop
    if (c.item === 'bag') { ctx.beginPath(); ctx.moveTo(neck[0] - 20, neck[1] + 10); ctx.lineTo(hip[0] + 50 * fwd, hip[1] - 20); ctx.lineWidth = 6; ctx.strokeStyle = INK; ctx.stroke(); box(ctx, hip[0] + 30 * fwd - 30, hip[1] - 40, 60, 52, shade(P.S, 0.15), 10); }
    if (c.item === 'scarf') { line(ctx, [[neck[0] - 26, neck[1] + 4], [neck[0] + 26, neck[1] + 4]], c.itemColor || tint(P.S, 0.25), 18); line(ctx, [[neck[0] + 14 * fwd, neck[1] + 8], [neck[0] + 22 * fwd, neck[1] + 56]], c.itemColor || tint(P.S, 0.25), 14); }
    const isT = (sh2, h2) => { const dx = Math.abs(h2[0] - sh2[0]); const dy = Math.abs(h2[1] - sh2[1]); return dx > 70 && dy < 0.45 * dx; };
    const arms = { key, shF, shA, HF, HA, EF, EA, tpose: isT(shF, HF) && isT(shA, HA), held: heldInfo };
    // head (circle), hair, face
    head(ctx, c, hx, hy, HR, { look, glance, eyes: st.eyes, back, t, blinkSeed: x, symbol: st.symbol, k, accent: o.accent, P, mood: o.mood });
    return { x: hx, y: hy, r: HR, back, id: c.id, arms };
  }
  function hair(ctx, c, x, y, r, side, back, front) {
    const col = c.hairColor; const h = c.hair;
    if (front === false) { // drawn behind the head
      if (h === 'long') { rr(ctx, x - r * 1.08, y - r * 0.4, r * 2.16, r * 1.9, r * 0.6); fillOut(ctx, col, 6); }
      if (h === 'ponytail') { ctx.beginPath(); ctx.ellipse(x - (side || 0.8) * r * 1.05, y + r * 0.25, r * 0.32, r * 0.75, -0.25 * (side || 1), 0, TAU); fillOut(ctx, col, 6); }
      if (h === 'bun') circ(ctx, x, y - r * 1.02, r * 0.42, col, 6);
      return;
    }
    ctx.save(); ctx.beginPath(); ctx.arc(x, y, r + 3, 0, TAU); ctx.clip();
    if (back && h !== 'none') { ctx.fillStyle = col; ctx.fillRect(x - r - 4, y - r - 4, 2 * r + 8, h === 'short' || h === 'spiky' || h === 'curly' ? r * 1.35 : 2 * r + 8); }
    else if (h === 'short' || h === 'ponytail' || h === 'bun' || h === 'spiky') { ctx.beginPath(); ctx.ellipse(x + side * 6, y - r * 0.55, r * 1.12, r * 0.62, 0, 0, TAU); ctx.fillStyle = col; ctx.fill(); }
    else if (h === 'long' || h === 'bob') { ctx.beginPath(); ctx.ellipse(x, y - r * 0.5, r * 1.15, r * 0.66, 0, 0, TAU); ctx.fillStyle = col; ctx.fill(); ctx.fillRect(x - r - 4, y - r * 0.4, r * 0.34, r * 1.3); ctx.fillRect(x + r * 0.7, y - r * 0.4, r * 0.4, r * 1.3); }
    else if (h === 'curly') { ctx.fillStyle = col; for (let i = 0; i < 7; i++) { ctx.beginPath(); ctx.arc(x - r + i * r / 3, y - r * 0.75 + (i % 2) * 8, r * 0.36, 0, TAU); ctx.fill(); } }
    ctx.restore();
    if (h === 'spiky' && !back) { for (let i = 0; i < 5; i++) { const a = -Math.PI * 0.85 + i * Math.PI * 0.175; ctx.beginPath(); ctx.moveTo(x + Math.cos(a - 0.15) * r, y + Math.sin(a - 0.15) * r); ctx.lineTo(x + Math.cos(a) * r * 1.38, y + Math.sin(a) * r * 1.38); ctx.lineTo(x + Math.cos(a + 0.15) * r, y + Math.sin(a + 0.15) * r); fillOut(ctx, col, 5); } }
    if (h === 'curly' && !back) for (let i = 0; i < 5; i++) circ(ctx, x - r * 0.8 + i * r * 0.4, y - r * 0.92, r * 0.3, col, 5);
    if (h === 'cap' || c.item === 'cap') { ctx.beginPath(); ctx.arc(x, y - r * 0.15, r * 1.02, Math.PI, 0); ctx.closePath(); fillOut(ctx, shade(c.top, 0.15), 6); if (!back) { rr(ctx, x + (side >= 0 ? 0 : -r * 1.5), y - r * 0.28, r * 1.5, r * 0.26, 8); fillOut(ctx, shade(c.top, 0.15), 6); } }
    if (h === 'beanie') { ctx.beginPath(); ctx.arc(x, y - r * 0.2, r * 1.04, Math.PI, 0); ctx.closePath(); fillOut(ctx, c.itemColor || tint(c.top, 0.2), 6); rr(ctx, x - r * 1.08, y - r * 0.36, r * 2.16, r * 0.34, 10); fillOut(ctx, shade(c.top, 0.1), 6); circ(ctx, x, y - r * 1.28, r * 0.22, CREAM, 5); }
  }
  function head(ctx, c, x, y, r, f) {
    const side = f.look || 0;
    hair(ctx, c, x, y, r, side, f.back, false);
    circ(ctx, x, y, r, CREAM, OUT);
    hair(ctx, c, x, y, r, side, f.back, true);
    if (c.item === 'headphones') { ctx.beginPath(); ctx.arc(x, y - 4, r * 1.12, Math.PI * 1.05, Math.PI * 1.95); ctx.lineWidth = 9; ctx.strokeStyle = INK; ctx.stroke(); box(ctx, x - r * 1.22, y - 16, 22, 40, tint(c.top, 0.1), 8); box(ctx, x + r * 1.22 - 22, y - 16, 22, 40, tint(c.top, 0.1), 8); }
    if (c.item === 'bow') { ctx.beginPath(); ctx.ellipse(x + r * 0.55 - 16, y - r * 0.92, 16, 11, -0.5, 0, TAU); fillOut(ctx, c.itemColor || '#FF9EBB', 4); ctx.beginPath(); ctx.ellipse(x + r * 0.55 + 16, y - r * 0.92, 16, 11, 0.5, 0, TAU); fillOut(ctx, c.itemColor || '#FF9EBB', 4); }
    if (c.item === 'flower') { circ(ctx, x - r * 0.7, y - r * 0.7, 13, '#FFAFCC', 4); circ(ctx, x - r * 0.7, y - r * 0.7, 5, '#FFE066', 2); }
    if (f.back) return;
    // face: dot / oval eyes, tiny mouth, blush (simple on purpose)
    const s = r / HR; const ex = side * 12 * s + f.glance * 9 * s; const eyeY = y + 2 * s; const gap = 20 * s;
    const blink = ((f.t + (f.blinkSeed % 3)) % 3.1) < 0.11;
    ctx.fillStyle = INK; ctx.strokeStyle = INK; ctx.lineCap = 'round';
    const eyes = f.eyes;
    for (const sx of [-1, 1]) {
      const cx = x + ex + sx * gap;
      if (blink || eyes === 'closed') { ctx.lineWidth = 5 * s; ctx.beginPath(); ctx.moveTo(cx - 8 * s, eyeY); ctx.lineTo(cx + 8 * s, eyeY); ctx.stroke(); continue; }
      if (eyes === 'happy') { ctx.lineWidth = 5.5 * s; ctx.beginPath(); ctx.arc(cx, eyeY + 4 * s, 8 * s, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke(); continue; }
      const ry = eyes === 'wide' || eyes === 'sparkle' ? 11 : 8; const rx = eyes === 'wide' || eyes === 'sparkle' ? 8 : 6;
      ctx.beginPath(); ctx.ellipse(cx, eyeY, rx * s, ry * s, 0, 0, TAU); ctx.fill();
      if (eyes === 'sparkle' || eyes === 'wide') { ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); ctx.arc(cx + 2.5 * s, eyeY - 3.5 * s, 2.8 * s, 0, TAU); ctx.fill(); ctx.fillStyle = INK; }
      if (eyes === 'worried') { ctx.lineWidth = 4.5 * s; ctx.beginPath(); ctx.moveTo(cx - 9 * s * sx, eyeY - 20 * s); ctx.lineTo(cx + 9 * s * sx, eyeY - 15 * s); ctx.stroke(); }
    }
    if (c.item === 'glasses') { ctx.lineWidth = 4.5 * s; ctx.strokeStyle = INK; for (const sx of [-1, 1]) { ctx.beginPath(); ctx.arc(x + ex + sx * gap, eyeY, 15 * s, 0, TAU); ctx.stroke(); } ctx.beginPath(); ctx.moveTo(x + ex - gap + 15 * s, eyeY); ctx.lineTo(x + ex + gap - 15 * s, eyeY); ctx.stroke(); }
    const my = y + 26 * s; const mx = x + ex * 0.8; ctx.lineWidth = 5 * s;
    if (f.eyes === 'wide' && f.mood !== 'snap') { ctx.beginPath(); ctx.ellipse(mx, my + 2 * s, 6 * s, 8 * s, 0, 0, TAU); ctx.stroke(); }
    else if (f.eyes === 'happy' || f.eyes === 'sparkle' || f.mood === 'snap') { ctx.beginPath(); ctx.arc(mx, my - 4 * s, 11 * s, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke(); }
    else if (f.eyes === 'worried' || f.k > 0.6) { ctx.beginPath(); ctx.moveTo(mx - 9 * s, my + 2 * s); ctx.quadraticCurveTo(mx - 3 * s, my - 3 * s, mx, my + 2 * s); ctx.quadraticCurveTo(mx + 3 * s, my + 6 * s, mx + 9 * s, my); ctx.stroke(); }
    else { ctx.beginPath(); ctx.moveTo(mx - 7 * s, my); ctx.lineTo(mx + 7 * s, my); ctx.stroke(); }
    if (f.eyes === 'happy' || f.eyes === 'sparkle' || f.mood === 'snap') { ctx.fillStyle = 'rgba(255,120,150,0.35)'; ctx.beginPath(); ctx.ellipse(x + ex - 34 * s, y + 18 * s, 10 * s, 6 * s, 0, 0, TAU); ctx.ellipse(x + ex + 34 * s, y + 18 * s, 10 * s, 6 * s, 0, 0, TAU); ctx.fill(); }
    symbol(ctx, f.symbol, x + r * 1.05, y - r * 1.05, s, f.t, f.accent, f.P);
  }
  function symbol(ctx, kind, x, y, s, t, accent, P) {
    if (!kind || kind === 'none') return; const b = Math.sin(t * 4) * 4 * s; y += b;
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    if (kind === 'sweat') { ctx.beginPath(); ctx.moveTo(0, -26); ctx.quadraticCurveTo(18, 2, 0, 10); ctx.quadraticCurveTo(-18, 2, 0, -26); fillOut(ctx, '#7FD3FF', 4.5); }
    if (kind === 'heart') { ctx.beginPath(); ctx.moveTo(0, 12); ctx.bezierCurveTo(-30, -8, -16, -34, 0, -18); ctx.bezierCurveTo(16, -34, 30, -8, 0, 12); fillOut(ctx, '#FF6B9A', 4.5); }
    if (kind === 'question' || kind === 'exclaim') { ctx.font = `900 64px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineWidth = 8; ctx.strokeStyle = INK; const ch = kind === 'question' ? '?' : '!'; ctx.strokeText(ch, 6, -6); ctx.fillStyle = kind === 'exclaim' && accent ? P.A : '#FFFFFF'; ctx.fillText(ch, 6, -6); }
    if (kind === 'sparkle') { const star = (sx, sy, r) => { ctx.beginPath(); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; const rr2 = i % 2 ? r * 0.35 : r; ctx.lineTo(sx + Math.cos(a) * rr2, sy + Math.sin(a) * rr2); } ctx.closePath(); fillOut(ctx, '#FFE066', 4); }; star(0, -6, 22 * (0.85 + 0.15 * Math.sin(t * 7))); star(28, 18, 11); }
    ctx.restore();
  }

  // ---------------- shots ----------------
  const XPOS = { left: 300, center: 540, right: 780 };
  class StoryRenderer {
    constructor(canvas) { this.c = canvas; this.ctx = canvas.getContext('2d'); this.layout = null; }
    // o: { timing (story.timing result), lines: [{panel, who, start, dur, text}] (video time), captions: true }
    setup(plan, o) {
      o = o || {}; this.p = plan; this.P = paletteOf(plan); this.tm = o.timing || VTS.story.timing(plan, o.lineDur); this.lines = o.lines || []; this.opt = o;
      this.chars = new Map(plan.characters.map((c, i) => [c.id, Object.assign({}, c, { itemColor: i % 2 ? tint(plan.colorScript.dominant.hex, -0) : tint(plan.colorScript.support.hex, 0.3) })]));
      this.total = this.tm.total; this.panels = plan.panels;
      // arm pose per figure per panel (saved by the engine, or mapped now from ACTION / BOARD NOTES for older plans)
      const S = VTS.story; this.poses = plan.panels.map((pn) => new Map(((pn.stage && pn.stage.chars) || []).map((sc) => [sc.id, sc.arms ? { arms: sc.arms, holds: sc.holds || null } : S && S.poseFor ? S.poseFor(plan, pn, sc) : { arms: 'idle', holds: null }])));
      return this;
    }
    shotAt(t) { const S = this.tm.shots; for (let i = S.length - 1; i >= 0; i--) if (t >= S[i].start) return { i, sh: S[i], local: t - S[i].start }; return { i: 0, sh: S[0], local: t }; }
    draw(t, opt) {
      opt = opt || {}; const ctx = this.ctx; const sx = this.c.width / W; ctx.setTransform(sx, 0, 0, sx, 0, 0); ctx.globalAlpha = 1;
      this.layout = { t, faces: [], text: [], figures: [], clue: null };
      if (t >= this.tm.endCard.start) { this.endCard(t - this.tm.endCard.start); return this.layout; }
      const { i, sh, local } = this.shotAt(t); const pn = this.panels[i]; const mp = clamp(local / sh.dur, 0, 1);
      this.shot(ctx, pn, i, local, mp, sh, t);
      // snap: a short dip to the accent colour (only at the snap)
      if (sh.snap && local < 0.26) { ctx.setTransform(sx, 0, 0, sx, 0, 0); ctx.globalAlpha = local < 0.08 ? 1 : 1 - (local - 0.08) / 0.18; ctx.fillStyle = this.P.A; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
      ctx.setTransform(sx, 0, 0, sx, 0, 0);
      if (opt.captions !== false) this.texts(ctx, pn, i, local, sh, t);
      return this.layout;
    }
    camera(pn, focus, mp, local, sh) {
      let s = 1.22; let fx = 540; let fy = 1000; let tx = 540; let ty = 1000;
      if (pn.shot === 'medium') { s = 2.0; fx = focus.x; fy = 1010; tx = 540; ty = 990; }
      if (pn.shot === 'close-up') { s = 2.9; fx = focus.x; fy = FEET - LEG - TORSO - NECK - HR; tx = 540; ty = 800; }
      if (pn.shot === 'over-shoulder') { s = 1.6; fx = focus.x; fy = 1000; tx = 650; ty = 990; }
      const mv = pn.silence ? 'hold' : pn.cameraMove;
      if (mv === 'slow push-in') s *= 1 + 0.085 * ease(mp);
      if (mv === 'slight pan') tx += lerp(-34, 34, ease(mp));
      if (mv === 'snap cut' && local < 0.22) s *= 1 + 0.1 * (1 - local / 0.22);
      return { s, fx, fy, tx, ty };
    }
    shot(ctx, pn, i, local, mp, sh, t) {
      const P = this.P; const accent = !!pn.accentAllowed; const st = pn.stage || { chars: [] };
      const k = pn.mood === 'snap' ? 0 : clamp((pn.tension - 1) / 4, 0, 1); const motion = st.motion || 'none';
      const n = (st.chars || []).length; const used = new Set();
      const placed = (st.chars || []).map((sc, j) => { let x = XPOS[sc.x] || 540; if (sc.far) x = sc.x === 'left' ? 170 : sc.x === 'center' ? 540 : 910; while ([...used].some((u) => Math.abs(u - x) < 160)) x += x > 540 ? -170 : 170; used.add(x); return { sc, x }; });
      const focusP = placed.find((q) => q.sc.id === st.focus) || placed.find((q) => !q.sc.far) || placed[0] || { x: XPOS[st.clue.x] || 540 };
      const clueX = XPOS[st.clue && st.clue.x] || 540;
      if (pn.shot === 'insert') return this.insert(ctx, pn, local, mp, t, accent, placed);
      const cam = this.camera(pn, pn.shot === 'close-up' || pn.shot === 'medium' || pn.shot === 'over-shoulder' ? (st.focus === 'clue' ? { x: clueX } : focusP) : { x: 540 }, mp, local, sh);
      const sx = this.c.width / W;
      ctx.setTransform(sx * cam.s, 0, 0, sx * cam.s, sx * (cam.tx - cam.fx * cam.s), sx * (cam.ty - cam.fy * cam.s));
      const open = motion === 'door' ? ease(mp) : 0;
      background(ctx, this.p, P, pn.location, t, open);
      if (motion === 'door' && !['hallway', 'elevator'].includes(pn.location)) door(ctx, 900, 560, 200, 590, P, open);
      // props for seated characters
      placed.forEach((q) => { if (q.sc.pose === 'sit' && !q.sc.far) stool(ctx, q.x, P); });
      // clue on a little table/counter in front (hidden = not drawn; partial = half hidden behind the counter edge)
      const clue = st.clue || {}; const showClue = clue.object && clue.object !== 'none' && clue.state !== 'hidden' && clue.object !== 'door';
      const poses = (this.poses && this.poses[i]) || new Map(); const poseOf = (sc) => poses.get(sc.id) || { arms: 'idle', holds: null };
      const clueAccent = accent && (clue.state === 'revealed' || pn.mood !== 'uneasy normal'); const clueLabel = clue.state === 'partial' ? partialLabel(clue.label) : clue.label;
      // who holds the clue (the prop is drawn at that character's hand, never on its own in the air)
      const holder = showClue ? placed.find((q) => !q.sc.far && holdMatch(poseOf(q.sc).holds, clue.object)) : null;
      const heldFor = (q) => { const h = poseOf(q.sc).holds; if (!h) return null; if (holder === q) return { kind: clue.object === 'letter' && h === 'note' ? 'letter' : h === 'cup' ? 'cup' : clue.object, label: clueLabel, accent: clueAccent, clue: true }; return { kind: h }; };
      const drawClue = () => { if (!showClue || holder) return; const big = clue.object === 'sign' || clue.object === 'banner' || clue.object === 'kitten' || clue.object === 'puppy'; const cx = clueX + (placed.some((q) => Math.abs(q.x - clueX) < 60) ? 120 : 0);
        const surf = SURFACE[pn.location]; let y = big ? FEET : 1010; let on = big ? 'floor' : 'table';
        if (!big && surf && cx >= surf[1] + 40 && cx <= surf[2] - 40) { y = surf[0] + 4; on = 'counter'; } else if (!big) table(ctx, cx, 1010, 200, P);
        clueObject(ctx, clue.object, cx, y, big ? 0.9 : 0.55, P, clueAccent, clueLabel, t); this.layout.clue = { object: clue.object, on }; };
      // far characters first (depth), then the clue, then the main characters
      placed.filter((q) => q.sc.far).forEach((q) => this.person(ctx, q, 0.62, { t, k: 0, motion: 'none', mp, accent, mood: pn.mood, arms: poseOf(q.sc).arms, held: heldFor(q) }, cam, sx));
      drawClue(); if (holder) this.layout.clue = { object: clue.object, on: 'hand', by: holder.sc.id };
      placed.filter((q) => !q.sc.far).forEach((q) => this.person(ctx, q, 1, { t, k: k * (q.sc.id === (focusP.sc && focusP.sc.id) ? 1 : 0.6), motion: q.sc.id === (focusP.sc && focusP.sc.id) || n === 1 ? motion : 'none', mp, accent, mood: pn.mood, arms: poseOf(q.sc).arms, held: heldFor(q) }, cam, sx));
      if (pn.shot === 'over-shoulder') { const other = placed.find((q) => q !== focusP && !q.sc.far); const c = other ? this.chars.get(other.sc.id) : null; ctx.setTransform(sx, 0, 0, sx, 0, 0); if (c) { line(ctx, [[60, 1500], [330, 1290]], c.top, 150); head(ctx, c, 210, 1100, 210, { look: 0, glance: 0, eyes: 'neutral', back: true, t, blinkSeed: 1, symbol: 'none', P }); } }
      // soft colour vignette (lighting is colour, not shade); held frames feel held
      ctx.setTransform(sx, 0, 0, sx, 0, 0); const vg = ctx.createRadialGradient(540, 860, 520, 540, 900, 1250); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, hexA(shade(P.D, 0.35), pn.silence ? 0.32 : 0.18)); ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
      if (accent && pn.mood !== 'snap' && pn.tension >= 4) { ctx.strokeStyle = hexA(P.A, 0.55 + 0.25 * Math.sin(t * 5)); ctx.lineWidth = 14; ctx.strokeRect(7, 7, W - 14, H - 14); }
    }
    person(ctx, q, scale, o, cam, sx) {
      const c = this.chars.get(q.sc.id); if (!c) return;
      ctx.save(); if (scale !== 1) { ctx.translate(q.x, FEET - 40); ctx.scale(scale, scale); ctx.translate(-q.x, -(FEET - 40)); }
      const hd = figure(ctx, c, q.sc, q.x, Object.assign({ P: this.P }, o));
      { const m = ctx.getTransform(); const k0 = this.c.width / W; const scr = (pt) => [+((m.a * pt[0] + m.c * pt[1] + m.e) / k0).toFixed(1), +((m.b * pt[0] + m.d * pt[1] + m.f) / k0).toFixed(1)]; const A2 = hd.arms; const h = A2.held;
        this.layout.figures.push({ id: c.id, arms: A2.key, tpose: A2.tpose, hands: [scr(A2.HF), scr(A2.HA)], held: h ? { kind: h.kind, hand: h.hand, at: scr(h.at), grip: scr(h.grip), handAt: h.hand === 'both' ? scr([(A2.HF[0] + A2.HA[0]) / 2, (A2.HF[1] + A2.HA[1]) / 2]) : scr(A2.HF) } : null }); }
      ctx.restore();
      // record the face box in screen space (for the caption/face overlap QA)
      if (!hd.back) { const k = cam.s * scale; const hx = scale !== 1 ? q.x + (hd.x - q.x) * scale : hd.x; const hy = scale !== 1 ? (FEET - 40) + (hd.y - (FEET - 40)) * scale : hd.y; const X = cam.tx + (hx - cam.fx) * cam.s; const Y = cam.ty + (hy - cam.fy) * cam.s; const R = hd.r * k; if (X + R > 0 && X - R < W && Y + R > 0 && Y - R < H) this.layout.faces.push({ id: c.id, x: X - R, y: Y - R, w: 2 * R, h: 2 * R }); }
    }
    insert(ctx, pn, local, mp, t, accent, placed) {
      const P = this.P; const sx = this.c.width / W; const st = pn.stage; const clue = st.clue || {};
      let s = 1; const mv = pn.silence ? 'hold' : pn.cameraMove; if (mv === 'slow push-in') s = 1 + 0.09 * ease(mp); if (mv === 'snap cut' && local < 0.22) s = 1.1 - 0.1 * local / 0.22;
      ctx.setTransform(sx * s, 0, 0, sx * s, sx * (540 - 540 * s), sx * (900 - 900 * s));
      const g = ctx.createLinearGradient(0, 0, 0, 1100); g.addColorStop(0, P.wall2); g.addColorStop(1, P.wall); ctx.fillStyle = g; ctx.fillRect(-500, -500, 2080, 1600);
      ctx.fillStyle = P.floor2; ctx.fillRect(-500, 1100, 2080, 1400); box(ctx, -60, 1060, 1200, 80, P.prop, 10);
      const gl = ctx.createRadialGradient(540, 820, 40, 540, 900, 700); gl.addColorStop(0, 'rgba(255,255,255,0.4)'); gl.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = gl; ctx.fillRect(-500, -500, 2080, 2600);
      const obj = clue.object && clue.object !== 'none' ? clue.object : 'cup';
      if (clue.state !== 'hidden') clueObject(ctx, obj, 540, 1080, 2.6, P, accent, clue.state === 'partial' ? partialLabel(clue.label) : clue.label, t);
      else { ctx.fillStyle = hexA(shade(P.S, 0.2), 0.25); ctx.beginPath(); ctx.ellipse(540, 1090, 260, 40, 0, 0, TAU); ctx.fill(); } // the empty place where the clue should be
      // a hand entering the frame (the one action in motion)
      if (st.motion === 'hand-enter' || st.motion === 'reach') { const who = this.chars.get((placed[0] && placed[0].sc.id) || (this.p.characters[0] || {}).id); const k = ease(mp); const hx = lerp(1250, 760, k); const hy = lerp(980, 940, k); line(ctx, [[1400, 1200], [hx, hy]], who ? who.top : P.S, 46); circ(ctx, hx, hy, 34, CREAM, 7); }
      ctx.setTransform(sx, 0, 0, sx, 0, 0); const vg = ctx.createRadialGradient(540, 900, 500, 540, 900, 1250); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, hexA(shade(P.D, 0.35), 0.2)); ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    }
    // lower-third captions + dialogue subtitle (never over faces; inside the safe margins); panel-1 hook text at the top
    texts(ctx, pn, i, local, sh, t) {
      const faces = this.layout.faces; const rows = [];
      // ONE SOURCE OF TRUTH: while a line is voiced, the burned-in text is exactly that line (narrator -> caption box, character ->
      // name-tagged box), from just before it starts until the next line of the panel. Unvoiced panels show their CAPTION.
      const row = (who, text, from) => { if (who === 'narrator') return { kind: 'caption', text, who, from }; const c = this.chars.get(who); return { kind: 'dialogue', who, name: c ? c.name : '', col: c ? c.top : this.P.S, text, from }; };
      const mine = this.lines.filter((l) => l.panel === i);
      if (mine.length) { const started = mine.filter((l) => t >= l.start - 0.12); const ln = started[started.length - 1]; if (ln) rows.push(Object.assign(row(ln.who, ln.text, ln.start - 0.12), { voiced: true })); }
      else if (!this.lines.length) { // not voiced yet (app preview): the lines the cast will read, in order through the shot
        const seq = []; if (this.p.narrator && this.p.narrator.use !== false && pn.narration && !pn.silence) seq.push(['narrator', pn.narration]);
        [pn.dialogue, pn.reply].forEach((d) => { if (d && d.line) seq.push([d.speaker, d.line]); });
        if (seq.length) { if (local > 0.15) { const span = Math.max(0.5, sh.dur - 0.3) / seq.length; const kq = Math.min(seq.length - 1, Math.floor((local - 0.15) / span)); rows.push(row(seq[kq][0], seq[kq][1], sh.start + 0.15 + kq * span)); } }
        else if (pn.caption && local > 0.15) rows.push({ kind: 'caption', text: pn.caption, from: sh.start + 0.15 });
      } else if (pn.caption && local > 0.15) rows.push({ kind: 'caption', text: pn.caption, from: sh.start + 0.15 });
      let y = CAP_TOP;
      // never over faces: if a face reaches into the lower third, push the block down (still inside the safe area)
      const faceBottom = faces.reduce((m, f) => (f.x < W - SAFE.side && f.x + f.w > SAFE.side ? Math.max(m, f.y + f.h) : m), 0);
      if (faceBottom + 16 > y) y = faceBottom + 16;
      for (const r of rows) {
        ctx.globalAlpha = clamp((t - r.from) / 0.16, 0, 1);
        // the whole text, never truncated: shrink to fit two lines, three lines as a last resort
        const maxW = W - 2 * SAFE.side - 60; let size = r.kind === 'dialogue' ? 50 : 46; let lines;
        for (;;) { ctx.font = `800 ${size}px ${FONT}`; lines = wrap(ctx, r.text, maxW); if (lines.length <= 2 || size <= 34) break; size -= 2; }
        const lw = Math.max(...lines.map((l) => ctx.measureText(l).width)); const bw = Math.min(W - 2 * SAFE.side, lw + 64); const bh = lines.length * size * 1.18 + 34 + (r.name ? 34 : 0);
        const bx = (W - bw) / 2;
        if (y + bh > SAFE.bottom) y = Math.max(CAP_TOP - 40, SAFE.bottom - bh);
        rr(ctx, bx, y, bw, bh, 26); ctx.fillStyle = r.kind === 'dialogue' ? '#FFFFFF' : hexA(INK, 0.86); ctx.fill(); ctx.lineWidth = 6; ctx.strokeStyle = INK; ctx.stroke();
        let ty = y + 17; if (r.name) { ctx.font = `900 28px ${FONT}`; const nw = ctx.measureText(r.name.toUpperCase()).width + 30; rr(ctx, bx + 24, y - 18, nw, 40, 20); ctx.fillStyle = r.col; ctx.fill(); ctx.lineWidth = 4; ctx.stroke(); ctx.fillStyle = lum(r.col) < 0.5 ? '#FFFFFF' : INK; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(r.name.toUpperCase(), bx + 39, y + 2); ty += 26; }
        ctx.font = `800 ${size}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = r.kind === 'dialogue' ? INK : '#FFFFFF';
        lines.forEach((l, k) => ctx.fillText(l, W / 2, ty + k * size * 1.18));
        this.layout.text.push({ kind: r.kind, who: r.who || null, voiced: !!r.voiced, text: r.text, drawn: lines.join(' '), x: bx, y: y - (r.name ? 18 : 0), w: bw, h: bh + (r.name ? 18 : 0) });
        y += bh + 22;
      }
      // panel-1 hook text (max 8 words), top safe area
      if (i === 0 && this.p.social && this.p.social.hookText && this.opt.hook !== false) {
        ctx.globalAlpha = clamp(local / 0.2, 0, 1) * (local > sh.dur - 0.2 ? clamp((sh.dur - local) / 0.2, 0, 1) : 1); ctx.font = `900 64px ${FONT}`; const lines = wrap(ctx, this.p.social.hookText.toUpperCase(), W - 2 * SAFE.side - 40).slice(0, 2);
        let hy = SAFE.top + 20; const faceTop = faces.reduce((m, f) => Math.min(m, f.y), H); const hh = lines.length * 74 + 40; if (hy + hh > faceTop - 16) hy = Math.max(120, faceTop - 16 - hh);
        const lw = Math.max(...lines.map((l) => ctx.measureText(l).width)); rr(ctx, (W - lw - 70) / 2, hy, lw + 70, hh, 30); ctx.fillStyle = this.P.S; ctx.fill(); ctx.lineWidth = 7; ctx.strokeStyle = INK; ctx.stroke();
        ctx.fillStyle = lum(this.P.S) < 0.55 ? '#FFFFFF' : INK; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; lines.forEach((l, k) => ctx.fillText(l, W / 2, hy + 22 + k * 74));
        this.layout.text.push({ kind: 'hook', x: (W - lw - 70) / 2, y: hy, w: lw + 70, h: hh });
      }
      ctx.globalAlpha = 1;
    }
    endCard(local) {
      const ctx = this.ctx; const P = this.P; const p = this.p; const A = P.A; const dark = lum(A) < 0.5;
      ctx.fillStyle = A; ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 0.18; for (let i = 0; i < 26; i++) { ctx.fillStyle = i % 2 ? '#FFFFFF' : INK; ctx.beginPath(); ctx.arc(hash(i) * W, hash(i + 40) * H, 8 + hash(i + 7) * 20, 0, TAU); ctx.fill(); } ctx.globalAlpha = 1;
      const k = ease(local / 0.35); ctx.save(); ctx.translate(540, 760); ctx.scale(0.9 + 0.1 * k, 0.9 + 0.1 * k);
      ctx.font = `900 104px ${FONT}`; const lines = wrap(ctx, (p.social.seriesTitle || '').toUpperCase(), 900).slice(0, 3);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineWidth = 16; ctx.strokeStyle = INK; ctx.lineJoin = 'round';
      lines.forEach((l, i) => { const y = (i - (lines.length - 1) / 2) * 116; ctx.strokeText(l, 0, y); ctx.fillStyle = '#FFFFFF'; ctx.fillText(l, 0, y); });
      ctx.restore();
      ctx.font = `800 50px ${FONT}`; ctx.fillStyle = dark ? '#FFFFFF' : INK; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; wrap(ctx, p.social.endCardLine || '', 860).slice(0, 2).forEach((l, i) => ctx.fillText(l, 540, 1020 + i * 62));
      // the cast, smiling (locked looks), well clear of the text
      const cs = p.characters; cs.forEach((c0, i) => { const c = this.chars.get(c0.id); const x = 540 + (i - (cs.length - 1) / 2) * 190; head(ctx, c, x, 1300 + Math.sin(local * 5 + i) * 6, 64, { look: 0, glance: 0, eyes: 'happy', back: false, t: local, blinkSeed: i, symbol: i === 0 ? 'heart' : 'sparkle', P, mood: 'snap' }); });
      this.layout.text.push({ kind: 'endcard', x: 90, y: 560, w: 900, h: 560 });
      if (local < 0.12) { ctx.globalAlpha = 1 - local / 0.12; ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
    }
    // a still of one panel (thumbnail strip, still-frame export): the moment after its one action
    drawPanel(i, o) { const sh = this.tm.shots[i]; const t = sh.start + Math.min(sh.dur - 0.05, Math.max(0.6, sh.dur * 0.72)); return this.draw(t, o); }
  }
  // surfaces small clues rest on (top y, x range) so a cup or note sits on the counter instead of hanging in front of it
  const SURFACE = { 'coffee shop': [880, -40, 1120], kitchen: [840, 330, 1090], 'party kitchen': [860, 330, 1090] };
  function holdMatch(h, obj) { if (!h || !obj) return false; if (h === obj) return true; return h === 'note' && (obj === 'letter' || obj === 'photo' || obj === 'ticket'); }
  // final-QA check: while a line is voiced, the on-screen caption/dialogue text is exactly the spoken text (and nothing else)
  const normText = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  function captionCheck(layout, lines) {
    const t = layout.t; const issues = []; const rows = layout.text.filter((r) => r.kind === 'caption' || r.kind === 'dialogue');
    const active = (lines || []).filter((l) => t >= l.start + 0.05 && t <= l.start + l.dur - 0.05);
    for (const l of active) { const hit = rows.find((r) => normText(r.drawn) === normText(l.text) && (r.who || 'narrator') === l.who); if (!hit) issues.push({ t: +t.toFixed(2), panel: l.panel + 1, who: l.who, voiced: l.text, onScreen: rows.map((r) => r.drawn) }); }
    if (active.length) { const extra = rows.filter((r) => !active.some((l) => normText(r.drawn) === normText(l.text))); if (extra.length) issues.push({ t: +t.toFixed(2), extraText: extra.map((r) => r.drawn), voiced: active.map((l) => l.text) }); }
    return issues;
  }
  // final-QA check: no T-pose, and every held prop sits on its hand anchor (within 2 px)
  function poseCheck(layout) {
    const issues = [];
    for (const f of layout.figures || []) {
      if (f.tpose) issues.push({ t: +layout.t.toFixed(2), id: f.id, issue: 'T-pose', arms: f.arms });
      if (f.held) { const d = Math.hypot(f.held.grip[0] - f.held.handAt[0], f.held.grip[1] - f.held.handAt[1]); if (d > 2) issues.push({ t: +layout.t.toFixed(2), id: f.id, issue: 'prop off the hand', kind: f.held.kind, px: +d.toFixed(1) }); }
    }
    return issues;
  }
  function partialLabel(s) { const w = String(s || '').split(/\s+/).filter(Boolean); if (!w.length) return ''; return w.length > 1 ? w.slice(0, Math.ceil(w.length / 2)).join(' ') + ' …' : w[0].slice(0, Math.max(2, Math.ceil(w[0].length / 2))) + '…'; }
  function wrap(ctx, text, maxW) { const ws = String(text || '').split(/\s+/).filter(Boolean); const out = []; let cur = ''; for (const w of ws) { const tst = cur ? cur + ' ' + w : w; if (ctx.measureText(tst).width > maxW && cur) { out.push(cur); cur = w; } else cur = tst; } if (cur) out.push(cur); return out; }
  // overlap check used by QA: any text box over any face box
  function overlaps(layout) { const hit = []; for (const f of layout.faces) for (const b of layout.text) { if (f.x < b.x + b.w && f.x + f.w > b.x && f.y < b.y + b.h && f.y + f.h > b.y) hit.push({ face: f.id, text: b.kind }); } return hit; }

  VTS.storyDraw = { StoryRenderer, overlaps, captionCheck, poseCheck, paletteOf, POSE_ARMS, W, H, SAFE, CAP_TOP };
}());
