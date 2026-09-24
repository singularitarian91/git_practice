// L'Homme au Chapeau: Théo's unfinished painting, drawn procedurally.
// Missing canvas scraps show as torn-out holes; `finished` paints the face
// Odile finally adds at the end (the apple lowered, a nine-year-old girl
// in her father's bowler hat).
function rng(seed) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }

export function drawPainting(canvas, { found = new Set(), finished = false, frame = true } = {}) {
  const W = canvas.width, H = canvas.height;
  const g = canvas.getContext('2d');
  const R = rng(1958);
  // linen ground
  g.fillStyle = '#d9cdb2'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(${R() > 0.5 ? '255,250,235' : '120,100,70'},0.08)`; g.fillRect(R() * W, R() * H, 1 + R() * 2, 1); }
  const paint = document.createElement('canvas'); paint.width = W; paint.height = H;
  const p = paint.getContext('2d');
  // sky: Magritte blue, soft cumulus
  const sky = p.createLinearGradient(0, 0, 0, H * 0.72);
  sky.addColorStop(0, '#5f8fc4'); sky.addColorStop(1, '#bcd3e6');
  p.fillStyle = sky; p.fillRect(0, 0, W, H * 0.72);
  for (let i = 0; i < 9; i++) {
    const cx = R() * W, cy = H * (0.08 + R() * 0.4), s = W * (0.06 + R() * 0.08);
    for (let k = 0; k < 7; k++) {
      const gr = p.createRadialGradient(cx + (R() - 0.5) * s * 2, cy + (R() - 0.5) * s * 0.6, 0, cx, cy, s);
      gr.addColorStop(0, 'rgba(255,255,255,0.85)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      p.fillStyle = gr; p.beginPath(); p.arc(cx + (R() - 0.5) * s * 2, cy + (R() - 0.5) * s * 0.5, s * (0.6 + R() * 0.5), 0, 7); p.fill();
    }
  }
  // low sea wall / desert horizon
  const ground = p.createLinearGradient(0, H * 0.68, 0, H);
  ground.addColorStop(0, '#c9a36a'); ground.addColorStop(1, '#8a6a45');
  p.fillStyle = ground; p.fillRect(0, H * 0.7, W, H * 0.3);
  p.fillStyle = 'rgba(40,30,20,0.25)'; p.fillRect(0, H * 0.7, W, 3);
  // brush texture over everything
  for (let i = 0; i < 1400; i++) {
    const x = R() * W, y = R() * H;
    p.strokeStyle = `rgba(${y < H * 0.7 ? '255,255,255' : '60,40,20'},${0.03 + R() * 0.04})`;
    p.lineWidth = 1 + R() * 3; p.beginPath(); p.moveTo(x, y); p.lineTo(x + (R() - 0.5) * 30, y + (R() - 0.5) * 6); p.stroke();
  }
  // the figure: dark overcoat, red scarf, bowler hat
  const cx = W * 0.5, top = H * 0.2;
  p.fillStyle = '#23262e';
  p.beginPath();
  p.moveTo(cx - W * 0.2, H); p.lineTo(cx - W * 0.17, top + H * 0.3); p.quadraticCurveTo(cx - W * 0.16, top + H * 0.2, cx - W * 0.08, top + H * 0.19);
  p.lineTo(cx + W * 0.08, top + H * 0.19); p.quadraticCurveTo(cx + W * 0.16, top + H * 0.2, cx + W * 0.17, top + H * 0.3); p.lineTo(cx + W * 0.2, H);
  p.closePath(); p.fill();
  p.strokeStyle = 'rgba(0,0,0,0.35)'; p.lineWidth = 2;
  p.beginPath(); p.moveTo(cx, top + H * 0.22); p.lineTo(cx - W * 0.02, H); p.stroke();
  for (let k = 0; k < 3; k++) { p.fillStyle = '#111'; p.beginPath(); p.arc(cx + W * 0.012, top + H * (0.3 + k * 0.1), 3, 0, 7); p.fill(); }
  p.fillStyle = '#b3262b';
  p.beginPath(); p.ellipse(cx, top + H * 0.185, W * 0.06, H * 0.018, 0, 0, 7); p.fill();
  p.fillRect(cx + W * 0.01, top + H * 0.19, W * 0.022, H * 0.12);
  // head
  const hx = cx, hy = top + H * 0.1;
  p.fillStyle = finished ? '#e6bf9c' : '#cfa987';
  p.beginPath(); p.ellipse(hx, hy, W * 0.058, H * 0.068, 0, 0, 7); p.fill();
  // bowler hat
  p.fillStyle = '#121317';
  p.beginPath(); p.ellipse(hx, hy - H * 0.05, W * 0.09, H * 0.012, 0, 0, 7); p.fill();
  p.beginPath(); p.ellipse(hx, hy - H * 0.068, W * 0.062, H * 0.042, 0, Math.PI, 0); p.fill();
  p.fillRect(hx - W * 0.062, hy - H * 0.068, W * 0.124, H * 0.018);
  p.fillStyle = '#2b1d24'; p.fillRect(hx - W * 0.062, hy - H * 0.062, W * 0.124, H * 0.008);
  const apple = (ax, ay, r) => {
    const gr = p.createRadialGradient(ax - r * 0.3, ay - r * 0.3, r * 0.1, ax, ay, r);
    gr.addColorStop(0, '#b6e36a'); gr.addColorStop(1, '#4f8a22');
    p.fillStyle = gr; p.beginPath(); p.arc(ax, ay, r, 0, 7); p.fill();
    p.strokeStyle = '#4a321d'; p.lineWidth = 3; p.beginPath(); p.moveTo(ax, ay - r * 0.9); p.lineTo(ax + 3, ay - r * 1.25); p.stroke();
    p.fillStyle = '#3f7f26'; p.beginPath(); p.ellipse(ax + r * 0.35, ay - r * 1.15, r * 0.35, r * 0.14, -0.4, 0, 7); p.fill();
  };
  if (finished) {
    // a girl of nine in her father's hat, laughing; the apple held down at her collar
    p.fillStyle = '#3a2618';
    p.beginPath(); p.ellipse(hx, hy - H * 0.012, W * 0.064, H * 0.05, 0, Math.PI * 1.02, Math.PI * 1.98); p.fill();
    p.fillRect(hx - W * 0.064, hy - H * 0.02, W * 0.02, H * 0.06); p.fillRect(hx + W * 0.044, hy - H * 0.02, W * 0.02, H * 0.06);
    p.fillStyle = '#2a1a12';
    p.beginPath(); p.arc(hx - W * 0.022, hy + H * 0.0, W * 0.007, 0, 7); p.fill();
    p.beginPath(); p.arc(hx + W * 0.022, hy + H * 0.0, W * 0.007, 0, 7); p.fill();
    p.strokeStyle = '#7a3a2c'; p.lineWidth = 2.5;
    p.beginPath(); p.arc(hx, hy + H * 0.02, W * 0.02, 0.2, Math.PI - 0.2); p.stroke();
    p.fillStyle = 'rgba(220,120,110,0.35)';
    p.beginPath(); p.arc(hx - W * 0.035, hy + H * 0.018, W * 0.012, 0, 7); p.fill();
    p.beginPath(); p.arc(hx + W * 0.035, hy + H * 0.018, W * 0.012, 0, 7); p.fill();
    apple(hx + W * 0.07, top + H * 0.24, W * 0.04);
  } else {
    apple(hx, hy + H * 0.005, W * 0.052);
  }
  // paste the painting onto the linen, leaving holes where scraps are missing (3x3 grid)
  const cols = 3, rows = 3, cw = W / cols, ch = H / rows;
  const R2 = rng(77);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const id = r * cols + c + 1;
    g.save();
    if (!found.has(id) && !finished) {
      // a torn hole: draw everything *except* a jagged patch
      g.beginPath();
      g.rect(0, 0, W, H);
      const px = c * cw + cw / 2, py = r * ch + ch / 2;
      const pts = 18;
      for (let i = 0; i <= pts; i++) {
        const a = (i / pts) * Math.PI * 2;
        const rr = Math.min(cw, ch) * (0.26 + R2() * 0.1);
        const x = px + Math.cos(a) * rr * 1.1, y = py + Math.sin(a) * rr;
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.closePath();
      g.clip('evenodd');
    }
    g.beginPath(); g.rect(c * cw, r * ch, cw, ch); g.clip();
    g.drawImage(paint, 0, 0);
    g.restore();
  }
  // unfinished pencil lines where the face should be
  if (!finished) {
    g.strokeStyle = 'rgba(60,50,40,0.25)'; g.lineWidth = 1;
    for (let i = 0; i < 6; i++) { g.beginPath(); g.ellipse(hx, hy, W * (0.05 + i * 0.003), H * (0.062 + i * 0.002), 0.05 * i, 0, 7); g.stroke(); }
  }
  if (frame) {
    g.strokeStyle = 'rgba(40,30,20,0.35)'; g.lineWidth = 6; g.strokeRect(3, 3, W - 6, H - 6);
  }
  return canvas;
}
