(() => {
  const canvas = document.getElementById('grid-bg');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let w, h;
  const GRID = 24;
  const ACCENT = [0, 255, 136];
  let t = 0;
  let dots = [];
  let mouse = { x: -9999, y: -9999, active: false };
  let smoothMouse = { x: -9999, y: -9999 };
  let mouseSpeed = 0;
  let prevMouse = { x: -9999, y: -9999 };
  let smoothRadius = 120;

  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
    initDots();
  }

  function initDots() {
    dots = [];
    for (let i = 0; i < 5; i++) {
      dots.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.3,
        r: 140 + Math.random() * 180,
      });
    }
  }

  function dd(x1, y1, x2, y2) {
    return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
  }

  function getGlow(px, py) {
    let val = 0;
    // Autonomous glow dots
    for (const d of dots) {
      const dist = dd(px, py, d.x, d.y);
      if (dist < d.r) val += (1 - dist / d.r) * 0.45;
    }
    // Mouse glow — radius scales with movement speed
    if (mouse.active) {
      const dist = dd(px, py, smoothMouse.x, smoothMouse.y);
      const mr = smoothRadius;
      if (dist < mr) val += (1 - dist / mr) * 0.5;
    }
    return Math.min(val, 1);
  }

  function draw() {
    t += 0.003;
    ctx.clearRect(0, 0, w, h);

    // Lerp smooth mouse toward actual mouse
    const lerp = 0.06;
    smoothMouse.x += (mouse.x - smoothMouse.x) * lerp;
    smoothMouse.y += (mouse.y - smoothMouse.y) * lerp;

    // Track mouse speed → drive glow radius
    mouseSpeed = dd(mouse.x, mouse.y, prevMouse.x, prevMouse.y);
    prevMouse.x = mouse.x;
    prevMouse.y = mouse.y;
    const targetRadius = Math.min(280, 15 + mouseSpeed * 10);
    smoothRadius += (targetRadius - smoothRadius) * 0.035;

    for (const d of dots) {
      d.x += d.vx;
      d.y += d.vy;
      if (d.x < -100 || d.x > w + 100) d.vx *= -1;
      if (d.y < -100 || d.y > h + 100) d.vy *= -1;
    }

    const offsetX = Math.sin(t) * 8;
    const offsetY = Math.cos(t * 0.7) * 6;

    // Vertical lines
    for (let x = -GRID; x <= w + GRID; x += GRID) {
      const sx = x + offsetX;
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, h);
      const glow = getGlow(sx, h / 2);
      const alpha = 0.025 + glow * 0.09;
      ctx.strokeStyle = `rgba(${ACCENT[0]},${ACCENT[1]},${ACCENT[2]},${alpha})`;
      ctx.lineWidth = 0.4 + glow * 0.6;
      ctx.stroke();
    }

    // Horizontal lines
    for (let y = -GRID; y <= h + GRID; y += GRID) {
      const sy = y + offsetY;
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(w, sy);
      const glow = getGlow(w / 2, sy);
      const alpha = 0.025 + glow * 0.09;
      ctx.strokeStyle = `rgba(${ACCENT[0]},${ACCENT[1]},${ACCENT[2]},${alpha})`;
      ctx.lineWidth = 0.4 + glow * 0.6;
      ctx.stroke();
    }

    // Intersection dots — brighter near mouse
    for (let x = -GRID; x <= w + GRID; x += GRID) {
      for (let y = -GRID; y <= h + GRID; y += GRID) {
        const sx = x + offsetX;
        const sy = y + offsetY;
        const glow = getGlow(sx, sy);
        if (glow > 0.1) {
          ctx.beginPath();
          ctx.arc(sx, sy, 0.8 + glow * 1.5, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${ACCENT[0]},${ACCENT[1]},${ACCENT[2]},${glow * 0.3})`;
          ctx.fill();
        }
      }
    }

    requestAnimationFrame(draw);
  }

  window.addEventListener('resize', resize);
  window.addEventListener('mousemove', (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.active = true;
  });
  window.addEventListener('mouseleave', () => {
    mouse.active = false;
  });

  resize();
  draw();
})();
