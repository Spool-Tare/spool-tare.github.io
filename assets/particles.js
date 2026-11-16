// Background particle layer: drifting points joined by lines when they come close.
// Pauses when the tab is hidden or the canvas is off screen; draws one still frame under reduced motion.

const BLUE = '100, 200, 255';
const VIOLET = '167, 139, 250';
const LINK_DISTANCE = 140;
const POINTER_DISTANCE = 200;
const MAX_PARTICLES = 120;
const AREA_PER_PARTICLE = 10000;

const canvas = document.getElementById('particles');
const nebula = document.getElementById('nebula');
const ctx = canvas?.getContext('2d');

if (ctx) {
  // The nebula blooms get a random position once and then stay put.
  if (nebula) {
    const at = (min, max) => `${Math.round(min + Math.random() * (max - min))}%`;
    nebula.style.setProperty('--violet-x', at(55, 90));
    nebula.style.setProperty('--violet-y', at(5, 40));
    nebula.style.setProperty('--blue-x', at(5, 40));
    nebula.style.setProperty('--blue-y', at(50, 90));
  }

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const pointer = { x: -9999, y: -9999 };
  let particles = [];
  let width = 0;
  let height = 0;
  let frame = 0;
  let onScreen = true;

  const random = (min, max) => min + Math.random() * (max - min);

  function resize() {
    const ratio = Math.min(devicePixelRatio || 1, 2);
    width = innerWidth;
    height = innerHeight;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

    const wanted = Math.min(MAX_PARTICLES, Math.floor((width * height) / AREA_PER_PARTICLE));
    particles = particles.filter((p) => p.x <= width && p.y <= height).slice(0, wanted);
    while (particles.length < wanted) {
      particles.push({
        x: random(0, width), y: random(0, height),
        vx: random(-0.25, 0.25), vy: random(-0.25, 0.25),
        r: random(1, 3),
        color: Math.random() < 0.7 ? BLUE : VIOLET,
      });
    }
    if (!frame) draw();
  }

  function step() {
    for (const p of particles) {
      const dx = p.x - pointer.x;
      const dy = p.y - pointer.y;
      const distance = Math.hypot(dx, dy);
      if (distance > 0 && distance < POINTER_DISTANCE) {
        const push = (1 - distance / POINTER_DISTANCE) * 0.6;
        p.x += (dx / distance) * push;
        p.y += (dy / distance) * push;
      }
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < -10) p.x = width + 10; else if (p.x > width + 10) p.x = -10;
      if (p.y < -10) p.y = height + 10; else if (p.y > height + 10) p.y = -10;
    }
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);

    ctx.lineWidth = 1;
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const a = particles[i];
        const b = particles[j];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (distance >= LINK_DISTANCE) continue;
        ctx.strokeStyle = `rgba(${BLUE}, ${(1 - distance / LINK_DISTANCE) * 0.35})`;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }

    ctx.shadowBlur = 8;
    for (const p of particles) {
      ctx.fillStyle = `rgba(${p.color}, 0.8)`;
      ctx.shadowColor = `rgba(${p.color}, 0.9)`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }

  function tick() {
    step();
    draw();
    frame = requestAnimationFrame(tick);
  }

  function update() {
    const shouldRun = onScreen && !document.hidden && !reducedMotion.matches;
    if (shouldRun && !frame) frame = requestAnimationFrame(tick);
    if (!shouldRun && frame) {
      cancelAnimationFrame(frame);
      frame = 0;
      draw();
    }
  }

  new IntersectionObserver(([entry]) => { onScreen = entry.isIntersecting; update(); }).observe(canvas);
  document.addEventListener('visibilitychange', update);
  reducedMotion.addEventListener('change', update);
  addEventListener('resize', resize);
  addEventListener('pointermove', (e) => { pointer.x = e.clientX; pointer.y = e.clientY; }, { passive: true });
  addEventListener('pointerleave', () => { pointer.x = pointer.y = -9999; });

  resize();
  update();
}
