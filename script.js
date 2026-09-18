(() => {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  /* ---------------- tabs ---------------- */
  const tabListeners = [];
  document.querySelectorAll("[data-tabs]").forEach((root) => {
    const tabs = [...root.querySelectorAll("[data-tab]")];
    const panels = [...root.querySelectorAll("[data-panel]")];
    const select = (id) => {
      tabs.forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === id)));
      panels.forEach((p) => { p.hidden = p.dataset.panel !== id; });
      tabListeners.forEach((fn) => fn(root, id));
    };
    tabs.forEach((t, i) => {
      t.addEventListener("click", () => select(t.dataset.tab));
      t.addEventListener("keydown", (e) => {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        const n = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
        n.focus(); select(n.dataset.tab);
      });
    });
  });

  /* ---------------- canvas helper ---------------- */
  function fitCanvas(canvas) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    return { w, h, dpr };
  }
  function onScreen(el, cb) {
    if (!("IntersectionObserver" in window)) { cb(true); return; }
    new IntersectionObserver((entries) => entries.forEach((e) => cb(e.isIntersecting)), { threshold: 0.05 }).observe(el);
  }

  /* ---------------- hero grid light cycles ---------------- */
  (function heroRace() {
    const crt = document.querySelector(".crt");
    const canvas = crt && crt.querySelector(".hero-race");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const CELL = 40;          // matches the .crt background grid
    const SPEED = 180;        // css px per second
    const TRAIL_MS = 2400;    // how long a light trail lingers
    const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    const riders = ["#7FD8FF", "#FF8A96", "#7FD8FF", "#FF8A96"].map((color) => ({ color }));
    let cols = 0, rows = 0, clock = 0, last = 0, raf = 0, visible = false;

    const rand = (n) => Math.floor(Math.random() * n);
    function spawn(r) {
      r.gx = 1 + rand(Math.max(1, cols - 1));
      r.gy = 1 + rand(Math.max(1, rows - 1));
      r.d = rand(4);
      r.prog = 0;
      r.trail = [{ x: r.gx * CELL, y: r.gy * CELL, t: clock }];
    }
    function layout() {
      const c = Math.floor(crt.clientWidth / CELL), rw = Math.floor(crt.clientHeight / CELL);
      if (c !== cols || rw !== rows) { cols = c; rows = rw; riders.forEach(spawn); }
    }
    function blocked(gx, gy, d) {
      const nx = gx + DIRS[d][0], ny = gy + DIRS[d][1];
      return nx < 1 || ny < 1 || nx > cols - 1 || ny > rows - 1;
    }
    function arrive(r) {
      r.gx += DIRS[r.d][0]; r.gy += DIRS[r.d][1];
      r.trail.push({ x: r.gx * CELL, y: r.gy * CELL, t: clock });
      const options = [r.d, (r.d + 1) % 4, (r.d + 3) % 4].filter((d) => !blocked(r.gx, r.gy, d));
      if (!options.length) { spawn(r); return; }
      const keepStraight = options[0] === r.d && Math.random() > 0.28;
      r.d = keepStraight ? r.d : options[1 + rand(options.length - 1)] ?? options[0];
    }
    function step(dt) {
      clock += dt;
      for (const r of riders) {
        r.prog += SPEED * dt / 1000;
        while (r.prog >= CELL) { r.prog -= CELL; arrive(r); }
        while (r.trail.length > 1 && clock - r.trail[1].t > TRAIL_MS) r.trail.shift();
      }
    }
    function draw() {
      const { w, h, dpr } = fitCanvas(canvas);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      for (const r of riders) {
        const hx = r.gx * CELL + DIRS[r.d][0] * r.prog, hy = r.gy * CELL + DIRS[r.d][1] * r.prog;
        const pts = [...r.trail, { x: hx, y: hy, t: clock }];
        ctx.strokeStyle = r.color; ctx.shadowColor = r.color;
        for (let i = 1; i < pts.length; i++) {
          const life = 1 - (clock - pts[i].t) / TRAIL_MS;
          if (life <= 0) continue;
          ctx.globalAlpha = 0.65 * life * life;
          ctx.lineWidth = 2; ctx.shadowBlur = 10;
          ctx.beginPath(); ctx.moveTo(pts[i - 1].x + 0.5, pts[i - 1].y + 0.5); ctx.lineTo(pts[i].x + 0.5, pts[i].y + 0.5); ctx.stroke();
        }
        ctx.globalAlpha = 0.95; ctx.shadowBlur = 14; ctx.fillStyle = "#F4FBFF";
        ctx.beginPath(); ctx.arc(hx + 0.5, hy + 0.5, 2.6, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1; ctx.shadowBlur = 0;
    }
    function frame(now) {
      raf = 0;
      step(Math.min(64, now - last)); last = now;
      draw();
      if (visible) raf = requestAnimationFrame(frame);
    }
    function still() { layout(); for (let i = 0; i < 90; i++) step(1000 / 60); draw(); }
    const kick = () => {
      if (reduceMotion) { still(); return; }
      if (!raf && visible) { last = performance.now(); raf = requestAnimationFrame(frame); }
    };
    layout();
    onScreen(crt, (v) => { visible = v; kick(); });
    window.addEventListener("resize", () => { layout(); if (reduceMotion) still(); });
  })();

  /* ================================================================
     Schrödinger's Pong demo
     Integer simulation in 1/100 px units, mirroring shared/include/pong/sim.h.
     Local player = guest (right paddle, authoritative for its face).
     Remote player = host (left paddle); its verdict arrives after RTT/2.
     ================================================================ */
  (function pongDemo() {
    const canvas = document.getElementById("pong-canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const FIELD_W = 80000, FIELD_H = 60000, PADDLE_H = 5000, PADDLE_W = 1200, BALL = 1000;
    const SPEED = 500, DIAG = 353, PADDLE_SPD = 400, WIN = 7, TICK_MS = 1000 / 60;
    const A_FACE = PADDLE_W, B_FACE = FIELD_W - PADDLE_W - BALL;

    const rttInput = document.getElementById("pong-rtt");
    const rttOut = document.getElementById("pong-rtt-out");
    const btnSchro = document.getElementById("pong-mode-schro");
    const btnNaive = document.getElementById("pong-mode-naive");
    const btnPause = document.getElementById("pong-pause");
    const statusEl = document.getElementById("pong-status");
    const logEl = document.getElementById("pong-log");

    let mode = "schro";
    let paused = reduceMotion;
    let visible = false;
    btnPause.textContent = paused ? "Play" : "Pause";

    const s = {
      tick: 0, bx: FIELD_W / 2, by: FIELD_H / 2, vx: 0, vy: 0,
      pa: (FIELD_H - PADDLE_H) / 2, pb: (FIELD_H - PADDLE_H) / 2,
      sa: 0, sb: 0, serveTick: 90, lastScoredOn: Math.random() < 0.5 ? 0 : 1,
      schro: false, opt: 2, sx: [0, 0, 0, 0], sy: [0, 0, 0, 0], svx: [0, 0, 0, 0], svy: [0, 0, 0, 0],
      authTick: 0, authHit: 0, spawnTick: 0,
      aimA: 0, aimB: 0, lastDirA: 0, lastDirB: 0,
    };

    const hitType = (spawnY, paddleY) => {
      const c = spawnY + BALL / 2, top = paddleY, bot = paddleY + PADDLE_H;
      if (spawnY + BALL < top || spawnY > bot) return 0;
      const third = Math.trunc(PADDLE_H / 3);
      if (c < top + third) return 1;
      if (c > bot - third) return 3;
      return 2;
    };
    const HIT_NAMES = ["MISS", "UP", "MID", "DOWN"];

    function predictY(faceX) {
      // unfold wall reflections to find the ball's y when it reaches faceX
      if (s.vx === 0) return FIELD_H / 2;
      const t = (faceX - s.bx) / s.vx;
      if (t < 0) return FIELD_H / 2;
      const span = FIELD_H - BALL;
      let y = s.by + s.vy * t;
      y = ((y % (2 * span)) + 2 * span) % (2 * span);
      return y > span ? 2 * span - y : y;
    }
    function pickAim() {
      // remote host misses sometimes so both outcomes appear
      const r = Math.random();
      if (r < 0.28) return (Math.random() < 0.5 ? -1 : 1) * PADDLE_H * (1.05 + Math.random() * 0.25);
      return (Math.random() - 0.5) * PADDLE_H * 0.95;
    }
    function movePaddle(key, targetCenter) {
      const cur = s[key] + PADDLE_H / 2;
      const d = targetCenter - cur;
      let dir = Math.abs(d) < PADDLE_SPD ? 0 : Math.sign(d);
      s[key] += dir * PADDLE_SPD;
      s[key] = Math.max(0, Math.min(FIELD_H - PADDLE_H, s[key]));
    }
    function resetRound() {
      s.bx = FIELD_W / 2;
      s.by = 5000 + Math.floor(Math.random() * (FIELD_H - 10000));
      s.vx = 0; s.vy = 0;
      s.serveTick = s.tick + 60;
    }
    function spawnTimelines(face, dirSign) {
      s.sx[0] = s.bx; s.sy[0] = s.by; s.svx[0] = s.vx; s.svy[0] = s.vy;
      for (let i = 1; i <= 3; i++) { s.sx[i] = face; s.sy[i] = s.by; }
      s.svx[1] = dirSign * DIAG; s.svy[1] = -DIAG;
      s.svx[2] = dirSign * SPEED; s.svy[2] = 0;
      s.svx[3] = dirSign * DIAG; s.svy[3] = DIAG;
    }
    function adoptTimeline(i) {
      s.bx = s.sx[i]; s.by = s.sy[i]; s.vx = s.svx[i]; s.vy = s.svy[i];
    }
    const logLines = [];
    function log(line) {
      logLines.unshift(line); logLines.length = Math.min(logLines.length, 1);
      logEl.textContent = logLines[0];
    }

    function step() {
      const rttMs = Number(rttInput.value);
      const oneWayTicks = Math.round(rttMs / 2 / TICK_MS);

      // paddles: local AI tracks well, remote AI uses a per-rally aim offset
      const towardA = s.vx < 0, towardB = s.vx > 0;
      if (towardA && s.lastDirA !== -1) s.aimA = pickAim();
      if (towardB && s.lastDirB !== 1) s.aimB = (Math.random() - 0.5) * PADDLE_H * 0.8;
      s.lastDirA = towardA ? -1 : 0; s.lastDirB = towardB ? 1 : 0;
      movePaddle("pa", towardA ? predictY(A_FACE) + BALL / 2 + s.aimA : FIELD_H / 2);
      movePaddle("pb", towardB && !s.schro ? predictY(B_FACE) + BALL / 2 + s.aimB : FIELD_H / 2);

      // serve
      if (s.serveTick > 0) {
        if (s.tick >= s.serveTick) {
          s.vx = s.lastScoredOn === 0 ? -DIAG : DIAG;
          s.vy = Math.random() < 0.5 ? DIAG : -DIAG;
          s.serveTick = 0;
        } else { s.vx = 0; s.vy = 0; }
      }

      const prevX = s.bx;
      s.bx += s.vx; s.by += s.vy;
      if (s.by <= 0) { s.by = 0; s.vy = -s.vy; }
      if (s.by >= FIELD_H - BALL) { s.by = FIELD_H - BALL; s.vy = -s.vy; }

      // remote host face: outcome unknown until AuthCollision arrives
      if (prevX >= A_FACE && s.bx < A_FACE && !s.schro) {
        const actual = hitType(s.by, s.pa);
        spawnTimelines(A_FACE, 1);
        s.schro = true; s.spawnTick = s.tick;
        s.authHit = actual; s.authTick = s.tick + oneWayTicks;
        if (mode === "schro") { s.opt = 2; adoptTimeline(2); } else { s.opt = 0; adoptTimeline(0); }
      }

      // local guest face: authoritative, resolves instantly
      if (prevX <= B_FACE && s.bx > B_FACE && !s.schro) {
        const actual = hitType(s.by, s.pb);
        spawnTimelines(B_FACE, -1);
        adoptTimeline(actual);
        log(`tick ${s.tick} · AuthCollision hit=${HIT_NAMES[actual]} side=GUEST → host ×30 frames`);
      }

      if (s.schro) {
        for (let i = 0; i < 4; i++) {
          s.sx[i] += s.svx[i]; s.sy[i] += s.svy[i];
          if (s.sy[i] <= 0) { s.sy[i] = 0; s.svy[i] = -s.svy[i]; }
          if (s.sy[i] >= FIELD_H - BALL) { s.sy[i] = FIELD_H - BALL; s.svy[i] = -s.svy[i]; }
        }
        if (s.tick >= s.authTick) {
          adoptTimeline(s.authHit);
          s.schro = false;
          log(`tick ${s.tick} · AuthCollision hit=${HIT_NAMES[s.authHit]} side=HOST · collapsed after ${s.tick - s.spawnTick} ticks`);
        }
      }

      if (!s.schro) {
        if (s.bx < 0) { s.sb++; s.lastScoredOn = 0; resetRound(); }
        else if (s.bx > FIELD_W) { s.sa++; s.lastScoredOn = 1; resetRound(); }
        if (s.sa >= WIN || s.sb >= WIN) { s.sa = 0; s.sb = 0; }
      }
      s.tick++;
    }

    function draw() {
      const { w, h } = fitCanvas(canvas);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "#050C19"; ctx.fillRect(0, 0, w, h);
      // letterbox an 800x644 logical screen (44px HUD + 600px field) into the canvas
      const LW = 800, LH = 644, HUD = 44;
      const k = Math.min(w / LW, h / LH);
      const ox = (w - LW * k) / 2, oy = (h - LH * k) / 2;
      ctx.setTransform(k, 0, 0, k, ox, oy);
      const BT = 3;
      ctx.fillStyle = "#E6E8E2";
      ctx.fillRect(0, 0, LW, BT); ctx.fillRect(0, LH - BT, LW, BT);
      ctx.fillRect(0, 0, BT, LH); ctx.fillRect(LW - BT, 0, BT, LH);
      ctx.fillRect(0, HUD - BT, LW, BT);
      ctx.fillStyle = "rgba(127,216,255,0.35)"; ctx.fillRect(LW / 2 - 1, BT, 2, HUD - BT * 2);
      ctx.fillStyle = "rgba(80,170,255,0.09)";
      for (let gx = 80; gx < LW; gx += 80) ctx.fillRect(gx, HUD, 1, LH - HUD - BT);
      for (let gy = HUD + 75; gy < LH - BT; gy += 75) ctx.fillRect(BT, gy, LW - BT * 2, 1);
      ctx.fillStyle = "rgba(127,216,255,0.35)";
      for (let y = HUD; y < LH - BT; y += 30) ctx.fillRect(LW / 2 - 2, y, 4, 18);

      ctx.textBaseline = "middle";
      ctx.font = "600 28px 'Martian Mono', monospace";
      ctx.fillStyle = "#E6E8E2";
      ctx.textAlign = "right"; ctx.fillText(String(s.sa), LW / 2 - 16, HUD / 2 + 1);
      ctx.textAlign = "left"; ctx.fillText(String(s.sb), LW / 2 + 16, HUD / 2 + 1);
      ctx.font = "500 13px 'Martian Mono', monospace";
      ctx.fillStyle = "#9AA1A3";
      ctx.textAlign = "left"; ctx.fillText("HOST (remote)", BT + 10, HUD / 2);
      ctx.textAlign = "right"; ctx.fillText("YOU (guest)", LW - BT - 10, HUD / 2);

      const px = (v) => v / 100;
      if (s.schro && mode === "schro") {
        ctx.fillStyle = "rgba(229, 196, 84, 0.9)";
        for (let i = 0; i < 4; i++) {
          if (i === s.opt) continue;
          ctx.fillRect(px(s.sx[i]), px(s.sy[i]) + HUD, 10, 10);
        }
        ctx.font = "500 11px 'Martian Mono', monospace";
        ctx.fillStyle = "rgba(229, 196, 84, 0.75)";
        ctx.textAlign = "left";
        const labels = ["miss", "up", "mid", "down"];
        for (let i = 0; i < 4; i++) {
          const x = px(s.sx[i]), y = px(s.sy[i]) + HUD;
          if (x < 4 || x > LW - 40) continue;
          ctx.fillText(labels[i], x + 14, y + 5);
        }
      }
      const waiting = s.schro;
      ctx.fillStyle = waiting && mode === "schro" ? "#E5C454" : "#E6E8E2";
      ctx.fillRect(px(s.bx), px(s.by) + HUD, 10, 10);
      ctx.fillStyle = "#E6E8E2";
      ctx.fillRect(BT, px(s.pa) + HUD, 12, 50);
      ctx.fillRect(LW - 12 - BT, px(s.pb) + HUD, 12, 50);

      if (s.serveTick > 0) {
        const left = Math.ceil((s.serveTick - s.tick) / 60);
        if (left > 0) {
          ctx.font = "600 44px 'Martian Mono', monospace";
          ctx.fillStyle = "rgba(230,232,226,0.85)"; ctx.textAlign = "center";
          ctx.fillText(String(left), LW / 2, HUD + 300);
        }
      }
      statusEl.textContent = waiting
        ? `AWAITING HOST AUTH · ${Math.max(0, s.authTick - s.tick)} TICKS`
        : "IN SYNC";
      statusEl.style.color = waiting ? "var(--ghost)" : "var(--friend)";
    }

    let acc = 0, last = performance.now(), raf = 0;
    function frame(now) {
      raf = 0;
      const dt = Math.min(100, now - last); last = now;
      if (!paused) { acc += dt; while (acc >= TICK_MS) { step(); acc -= TICK_MS; } }
      draw();
      if (visible && !paused) raf = requestAnimationFrame(frame);
    }
    const kick = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } };

    rttInput.addEventListener("input", () => { rttOut.textContent = `${rttInput.value} ms`; });
    const setMode = (m) => {
      mode = m;
      btnSchro.setAttribute("aria-pressed", String(m === "schro"));
      btnNaive.setAttribute("aria-pressed", String(m === "naive"));
      draw();
    };
    btnSchro.addEventListener("click", () => setMode("schro"));
    btnNaive.addEventListener("click", () => setMode("naive"));
    btnPause.addEventListener("click", () => {
      paused = !paused; btnPause.textContent = paused ? "Play" : "Pause";
      if (!paused) kick(); else draw();
    });
    // run a few seconds headless so the first frame shows a rally in progress
    for (let i = 0; i < 150; i++) step();
    onScreen(canvas, (v) => { visible = v; if (v) kick(); });
    window.addEventListener("resize", () => draw());
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => draw());
    draw();
  })();

  /* ================================================================
     ProNav intercept sketch (2D top-down)
     Values from config/simulation.yaml: threat 950 m/s at 12 g,
     interceptor 1300 m/s at 55 g, 60 g axial, N = 4, 20 m swept fuze,
     batteries on an 11 km ring, 6 km protected radius.
     ================================================================ */
  (function pronavDemo() {
    const canvas = document.getElementById("pronav-canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const G = 9.81;
    const VIEW = { x0: -32000, x1: 32000, y0: -6000, y1: 30000 };
    const T_SPEED = 950, T_LAT = 12 * G;
    const I_SPEED = 1300, I_LAT = 55 * G, I_AXIAL = 60 * G;
    const FUZE = 20, PAD_R = 11000, PROTECT_R = 6000;

    const gainInput = document.getElementById("pn-gain");
    const gainOut = document.getElementById("pn-gain-out");
    const bPro = document.getElementById("pn-mode-pronav");
    const bPur = document.getElementById("pn-mode-pursuit");
    const bNew = document.getElementById("pn-new");

    let mode = "pronav";
    let run = null, prev = null;
    let visible = false, panelShown = false;

    const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

    function newRun(sx, sy) {
      if (run && run.tTrail.length > 2) prev = { tTrail: run.tTrail, iTrail: run.iTrail };
      let x = sx, y = sy;
      if (x === undefined) {
        const bearing = (Math.random() * 2 - 1) * (62 * Math.PI / 180);
        const range = 24000 + Math.random() * 6000;
        x = Math.sin(bearing) * range; y = Math.cos(bearing) * range;
      }
      const bearingToThreat = Math.atan2(x, y);
      const pad = { x: Math.sin(bearingToThreat) * PAD_R, y: Math.cos(bearingToThreat) * PAD_R };
      run = {
        t: 0, done: false, doneT: 0, result: "",
        th: { x, y, h: Math.atan2(-y, -x), alive: true, phase: Math.random() * 6.28 },
        it: { x: pad.x, y: pad.y, h: Math.atan2(y - pad.y, x - pad.x), v: 250, launched: false, alive: true },
        tTrail: [], iTrail: [], trailT: 0, burst: null,
        telem: { range: 0, vc: 0, ldot: 0, acmd: 0 },
      };
    }

    function step(dt) {
      const r = run; if (r.done) { r.doneT += dt; if (r.doneT > 3.2) newRun(); return; }
      r.t += dt;
      const th = r.th, it = r.it;
      // threat: steer toward the asset while weaving at up to 12 g
      const toAsset = Math.atan2(-th.y, -th.x);
      let omega = Math.max(-T_LAT / T_SPEED, Math.min(T_LAT / T_SPEED, 1.2 * wrap(toAsset - th.h)));
      omega += (0.75 * T_LAT * Math.sin(2 * Math.PI * r.t / 4.5 + th.phase)) / T_SPEED;
      th.h += omega * dt;
      const tvx = Math.cos(th.h) * T_SPEED, tvy = Math.sin(th.h) * T_SPEED;
      const t0x = th.x, t0y = th.y;
      th.x += tvx * dt; th.y += tvy * dt;

      const m0x = it.x, m0y = it.y;
      if (!it.launched && r.t > 0.8) it.launched = true;
      if (it.launched) {
        it.v = Math.min(I_SPEED, it.v + I_AXIAL * dt);
        const rx = th.x - it.x, ry = th.y - it.y;
        const mvx = Math.cos(it.h) * it.v, mvy = Math.sin(it.h) * it.v;
        const vrx = tvx - mvx, vry = tvy - mvy;
        const r2 = rx * rx + ry * ry, rn = Math.sqrt(r2);
        const ldot = (rx * vry - ry * vrx) / r2;
        const vc = -(rx * vrx + ry * vry) / rn;
        let a;
        if (mode === "pronav" && it.v > 600) a = Number(gainInput.value) * vc * ldot;
        else a = 5 * wrap(Math.atan2(ry, rx) - it.h) * it.v;
        a = Math.max(-I_LAT, Math.min(I_LAT, a));
        it.h += (a / it.v) * dt;
        it.x += Math.cos(it.h) * it.v * dt; it.y += Math.sin(it.h) * it.v * dt;
        r.telem = { range: rn, vc, ldot, acmd: Math.abs(a) / G };

        // swept proximity fuze: closest approach of the relative motion over this step
        const ax = t0x - m0x, ay = t0y - m0y;
        const dx = (th.x - it.x) - ax, dy = (th.y - it.y) - ay;
        const dd = dx * dx + dy * dy;
        const u = dd > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / dd)) : 0;
        const miss = Math.hypot(ax + dx * u, ay + dy * u);
        if (miss <= FUZE) {
          r.done = true; th.alive = false; it.alive = false;
          r.burst = { x: it.x, y: it.y, t: 0 };
          r.result = `INTERCEPT  t=${r.t.toFixed(1)} s  miss ${miss.toFixed(1)} m  ${(Math.hypot(th.x, th.y) / 1000).toFixed(1)} km from asset`;
        }
      }
      if (!r.done && Math.hypot(th.x, th.y) < 500) {
        r.done = true; th.alive = false; r.burst = { x: th.x, y: th.y, t: 0, loss: true };
        r.result = `ASSET LOSS  t=${r.t.toFixed(1)} s`;
      }
      if (!r.done && r.t > 70) { r.done = true; r.result = "INTERCEPTOR FUEL EXHAUSTED"; }
      r.trailT += dt;
      if (r.trailT > 0.08) {
        r.trailT = 0;
        r.tTrail.push([th.x, th.y]);
        if (it.launched) r.iTrail.push([it.x, it.y]);
      }
    }

    function draw() {
      const { w, h, dpr } = fitCanvas(canvas);
      const sx = (x) => ((x - VIEW.x0) / (VIEW.x1 - VIEW.x0)) * w;
      const sy = (y) => h - ((y - VIEW.y0) / (VIEW.y1 - VIEW.y0)) * h;
      const pxPerM = w / (VIEW.x1 - VIEW.x0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "#050C19"; ctx.fillRect(0, 0, w, h);

      // grid: 2 km minor, 10 km major
      for (let gx = -32000; gx <= 32000; gx += 2000) {
        ctx.strokeStyle = gx % 10000 === 0 ? "rgba(80,170,255,0.2)" : "rgba(80,170,255,0.09)";
        ctx.lineWidth = dpr; ctx.beginPath(); ctx.moveTo(sx(gx), 0); ctx.lineTo(sx(gx), h); ctx.stroke();
      }
      for (let gy = -6000; gy <= 30000; gy += 2000) {
        ctx.strokeStyle = gy % 10000 === 0 ? "rgba(80,170,255,0.2)" : "rgba(80,170,255,0.09)";
        ctx.beginPath(); ctx.moveTo(0, sy(gy)); ctx.lineTo(w, sy(gy)); ctx.stroke();
      }
      const font = (sz, wt = 500) => `${wt} ${sz * dpr}px 'Martian Mono', monospace`;
      ctx.font = font(10); ctx.fillStyle = "rgba(154,161,163,0.95)"; ctx.textAlign = "left"; ctx.textBaseline = "top";
      for (let gy = 10000; gy <= 30000; gy += 10000) ctx.fillText(`${gy / 1000} km`, 6 * dpr, sy(gy) + 3 * dpr);

      // rings around the defended asset
      const cx = sx(0), cy = sy(0);
      ctx.setLineDash([4 * dpr, 5 * dpr]);
      ctx.strokeStyle = "rgba(154,161,163,0.45)"; ctx.beginPath(); ctx.arc(cx, cy, PROTECT_R * pxPerM, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([1.5 * dpr, 5 * dpr]);
      ctx.strokeStyle = "rgba(154,161,163,0.3)"; ctx.beginPath(); ctx.arc(cx, cy, PAD_R * pxPerM, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#62C2D2"; ctx.fillRect(cx - 4 * dpr, cy - 4 * dpr, 8 * dpr, 8 * dpr);
      ctx.font = font(10); ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.fillStyle = "rgba(230,232,226,0.85)"; ctx.fillText("DEFENDED ASSET", cx, cy + 9 * dpr);
      ctx.textAlign = "right"; ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(154,161,163,0.95)"; ctx.fillText("6 km protected", cx - PROTECT_R * pxPerM - 8 * dpr, cy - 22 * dpr);
      ctx.fillStyle = "rgba(154,161,163,0.95)"; ctx.fillText("11 km battery ring", cx - PAD_R * pxPerM - 8 * dpr, cy + 22 * dpr);

      const trail = (pts, color, width) => {
        if (pts.length < 2) return;
        ctx.strokeStyle = color; ctx.lineWidth = width * dpr; ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y))));
        ctx.stroke();
      };
      if (prev) { trail(prev.tTrail, "rgba(229,196,84,0.16)", 1.5); trail(prev.iTrail, "rgba(116,210,126,0.18)", 1.5); }
      const r = run;
      trail(r.tTrail, "rgba(229,196,84,0.8)", 1.75);
      trail(r.iTrail, "rgba(116,210,126,0.9)", 1.75);

      const glyph = (x, y, hd, color, size) => {
        ctx.save(); ctx.translate(sx(x), sy(y)); ctx.rotate(-hd);
        ctx.fillStyle = color; ctx.beginPath();
        ctx.moveTo(size * dpr, 0); ctx.lineTo(-size * 0.7 * dpr, size * 0.55 * dpr); ctx.lineTo(-size * 0.7 * dpr, -size * 0.55 * dpr);
        ctx.closePath(); ctx.fill(); ctx.restore();
      };
      if (r.th.alive && r.it.launched && r.it.alive) {
        ctx.setLineDash([3 * dpr, 4 * dpr]); ctx.strokeStyle = "rgba(116,210,126,0.5)"; ctx.lineWidth = dpr;
        ctx.beginPath(); ctx.moveTo(sx(r.it.x), sy(r.it.y)); ctx.lineTo(sx(r.th.x), sy(r.th.y)); ctx.stroke(); ctx.setLineDash([]);
      }
      if (r.th.alive) glyph(r.th.x, r.th.y, r.th.h, "#E5C454", 8);
      if (r.it.alive) glyph(r.it.x, r.it.y, r.it.h, "#74D27E", 8);
      if (r.burst) {
        const b = r.burst; b.t += 1 / 60;
        const rad = (6 + b.t * 60) * dpr, al = Math.max(0, 1 - b.t / 1.2);
        ctx.strokeStyle = b.loss ? `rgba(240,90,60,${al})` : `rgba(229,196,84,${al})`;
        ctx.lineWidth = 2 * dpr; ctx.beginPath(); ctx.arc(sx(b.x), sy(b.y), rad, 0, Math.PI * 2); ctx.stroke();
      }

      // HUD
      const T = r.telem;
      const lines = [
        ["GUIDANCE", mode === "pronav" ? `PRONAV  N=${Number(gainInput.value).toFixed(1)}` : "PURE PURSUIT"],
        ["TIME", `${r.t.toFixed(2)} s`],
        ["RANGE", r.it.launched ? `${(T.range / 1000).toFixed(2)} km` : "--"],
        ["CLOSING", r.it.launched ? `${Math.round(T.vc).toLocaleString()} m/s` : "--"],
        ["LOS RATE", r.it.launched ? `${(T.ldot * 1000).toFixed(1)} mrad/s` : "--"],
        ["ACCEL CMD", r.it.launched ? `${T.acmd.toFixed(1)} g / 55 g` : "--"],
      ];
      ctx.textAlign = "left"; ctx.textBaseline = "top";
      const lh = 16 * dpr, x0 = 14 * dpr, y0 = 12 * dpr;
      ctx.fillStyle = "rgba(5,12,25,0.85)"; ctx.fillRect(0, 0, 250 * dpr, y0 * 2 + lh * lines.length);
      lines.forEach(([k, v], i) => {
        ctx.font = font(11); ctx.fillStyle = "#9AA1A3"; ctx.fillText(k, x0, y0 + i * lh);
        ctx.fillStyle = "#E6E8E2"; ctx.fillText(v, x0 + 92 * dpr, y0 + i * lh);
      });
      if (r.result) {
        ctx.font = font(12, 500); ctx.textAlign = "right";
        ctx.fillStyle = r.result.startsWith("INTERCEPT") ? "#74D27E" : "#E5C454";
        ctx.fillText(r.result, w - 14 * dpr, 12 * dpr);
      }
    }

    let raf = 0, last = 0, acc = 0;
    const DT = 1 / 240;
    function frame(now) {
      raf = 0;
      const el = Math.min(0.1, (now - last) / 1000); last = now;
      acc += el;
      while (acc >= DT) { step(DT); acc -= DT; }
      draw();
      if (visible && panelShown && !reduceMotion) raf = requestAnimationFrame(frame);
    }
    const kick = () => {
      if (reduceMotion) { draw(); return; }
      if (!raf && visible && panelShown) { last = performance.now(); raf = requestAnimationFrame(frame); }
    };
    const setMode = (m) => {
      mode = m;
      bPro.setAttribute("aria-pressed", String(m === "pronav"));
      bPur.setAttribute("aria-pressed", String(m === "pursuit"));
      gainInput.disabled = m !== "pronav";
      newRun(); draw();
    };
    bPro.addEventListener("click", () => setMode("pronav"));
    bPur.addEventListener("click", () => setMode("pursuit"));
    gainInput.addEventListener("input", () => { gainOut.textContent = Number(gainInput.value).toFixed(1); });
    gainInput.addEventListener("change", () => { newRun(); draw(); });
    bNew.addEventListener("click", () => { newRun(); draw(); if (reduceMotion) runInstant(); });
    canvas.addEventListener("click", (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = VIEW.x0 + ((e.clientX - rect.left) / rect.width) * (VIEW.x1 - VIEW.x0);
      const y = VIEW.y1 - ((e.clientY - rect.top) / rect.height) * (VIEW.y1 - VIEW.y0);
      if (Math.hypot(x, y) < 13000) return;
      newRun(x, y); draw(); if (reduceMotion) runInstant();
    });
    function runInstant() {
      // reduced motion: compute the whole engagement, show the final frame
      for (let i = 0; i < 240 * 75 && !run.done; i++) step(DT);
      draw();
    }
    newRun();
    tabListeners.push((root, id) => {
      if (!root.contains(canvas)) return;
      panelShown = id === "ds-pronav";
      if (panelShown) { if (reduceMotion) runInstant(); kick(); }
    });
    onScreen(canvas, (v) => { visible = v; kick(); });
    window.addEventListener("resize", () => { if (panelShown) draw(); });
  })();

  /* ---------------- résumé: fetched live, phone redacted in the browser ---------------- */
  (function resume() {
    const DOC_URL = "https://docs.google.com/document/d/1BwLKBQoat5y6sN8KNoNR2Y0Lccy53WdkXFKv1iRZjPY/export?format=pdf";
    const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
    const JSPDF = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
    const FILE_NAME = "Luke-Hinojosa-Resume.pdf";
    const SCALE = 2.5;
    const PHONE = /\+?1?[\s.]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;
    const PHONE_WITH_SEP = [
      new RegExp(String.raw`\s*[|•·]\s*` + PHONE.source),
      new RegExp(PHONE.source + String.raw`\s*[|•·]\s*`),
      PHONE,
    ];
    const buttons = [...document.querySelectorAll("[data-resume]")];
    const toast = document.getElementById("toast");
    let busy = false, toastTimer = 0;

    const loadScript = (src) => new Promise((resolve, reject) => {
      if ([...document.scripts].some((s) => s.src === src)) { resolve(); return; }
      const s = document.createElement("script");
      s.src = src; s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(`Could not load ${src}`));
      document.head.appendChild(s);
    });
    function say(message) {
      if (!toast) return;
      toast.textContent = message; toast.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { toast.hidden = true; }, 7000);
    }
    function removePhone(str) {
      for (const re of PHONE_WITH_SEP) { if (re.test(str)) return str.replace(re, "").trim(); }
      return str;
    }
    function inkColor(ctx, x, y, w, h) {
      const px = ctx.getImageData(x, y, Math.max(1, w), Math.max(1, h)).data;
      let best = 765, rgb = [0, 0, 0];
      for (let i = 0; i < px.length; i += 4) {
        const sum = px[i] + px[i + 1] + px[i + 2];
        if (sum < best) { best = sum; rgb = [px[i], px[i + 1], px[i + 2]]; }
      }
      return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
    }

    async function build() {
      await Promise.all([loadScript(PDFJS + "pdf.min.js"), loadScript(JSPDF)]);
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.js";
      const res = await fetch(DOC_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(`Google Docs answered ${res.status}`);
      const source = await window.pdfjsLib.getDocument({ data: new Uint8Array(await res.arrayBuffer()) }).promise;
      const { jsPDF } = window.jspdf;
      let out = null;

      for (let n = 1; n <= source.numPages; n++) {
        const page = await source.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: SCALE });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;

        const text = await page.getTextContent();
        const words = [];
        const redacted = [];
        for (const item of text.items) {
          if (!item.str.trim()) continue;
          const [, , c, d, e, f] = item.transform;
          const size = Math.hypot(c, d);
          if (!PHONE.test(item.str)) { words.push({ str: item.str, x: e, y: f, size, width: item.width }); continue; }

          // Paint out the whole line, then set it again without the number.
          const style = text.styles[item.fontName] || { ascent: 0.9, descent: -0.25 };
          const [x1, y1] = vp.convertToViewportPoint(e, f + style.ascent * size);
          const [x2, y2] = vp.convertToViewportPoint(e + item.width, f + style.descent * size);
          const box = { x: Math.floor(Math.min(x1, x2)) - 3, y: Math.floor(Math.min(y1, y2)) - 3, w: Math.ceil(Math.abs(x2 - x1)) + 6, h: Math.ceil(Math.abs(y2 - y1)) + 6 };
          const ink = inkColor(ctx, box.x, box.y, box.w, box.h);
          ctx.fillStyle = "#FFFFFF"; ctx.fillRect(box.x, box.y, box.w, box.h);
          redacted.push({ x1: e, x2: e + item.width, y1: f + style.descent * size, y2: f + style.ascent * size });

          const clean = removePhone(item.str);
          if (!clean || PHONE.test(clean)) continue;
          const family = document.fonts && document.fonts.check(`${size * SCALE}px "${item.fontName}"`) ? `"${item.fontName}", Arial, sans-serif` : "Arial, sans-serif";
          ctx.font = `${size * SCALE}px ${family}`;
          ctx.fillStyle = ink; ctx.textBaseline = "alphabetic";
          const newWidth = ctx.measureText(clean).width / SCALE;
          const newX = e + item.width / 2 - newWidth / 2;
          const [bx, by] = vp.convertToViewportPoint(newX, f);
          ctx.fillText(clean, bx, by);
          words.push({ str: clean, x: newX, y: f, size, width: newWidth });
        }

        const size = [base.width, base.height];
        const orientation = base.width > base.height ? "l" : "p";
        if (!out) out = new jsPDF({ unit: "pt", format: size, orientation, compress: true });
        else out.addPage(size, orientation);
        out.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, base.width, base.height, undefined, "FAST");

        // Invisible text layer so the PDF stays searchable and copyable (never includes the number).
        out.setFont("helvetica");
        for (const wd of words) {
          if (PHONE.test(wd.str)) continue;
          out.setFontSize(wd.size);
          const natural = out.getTextWidth(wd.str);
          out.text(wd.str, wd.x, base.height - wd.y, { renderingMode: "invisible", horizontalScale: natural > 0 ? wd.width / natural : 1 });
        }
        const annotations = await page.getAnnotations();
        for (const a of annotations) {
          if (a.subtype !== "Link" || !a.url || /^tel:/i.test(a.url)) continue;
          const [ax1, ay1, ax2, ay2] = a.rect;
          const hitsRedaction = redacted.some((r) => ax1 < r.x2 && ax2 > r.x1 && ay1 < r.y2 && ay2 > r.y1);
          if (hitsRedaction) continue;
          out.link(ax1, base.height - ay2, ax2 - ax1, ay2 - ay1, { url: a.url });
        }
      }
      out.setProperties({ title: "Luke Hinojosa Résumé", author: "Luke Hinojosa", subject: "Résumé" });
      return out;
    }

    async function run(button) {
      if (busy) return;
      busy = true;
      const mode = button.dataset.resume;
      const win = mode === "view" ? window.open("", "_blank") : null;
      if (win) {
        win.document.title = "Luke Hinojosa Résumé";
        win.document.body.style.cssText = "margin:0;min-height:100vh;display:grid;place-items:center;background:#0A1324;color:#B9C6D9;font:16px system-ui,sans-serif";
        win.document.body.textContent = "Building a fresh copy of the résumé…";
      }
      const label = button.textContent;
      buttons.forEach((b) => { b.disabled = true; b.setAttribute("aria-busy", "true"); });
      button.textContent = "Building PDF";
      try {
        const doc = await build();
        if (win) {
          const url = URL.createObjectURL(doc.output("blob"));
          win.location.href = url;
          setTimeout(() => URL.revokeObjectURL(url), 120000);
        } else {
          doc.save(FILE_NAME);
        }
      } catch (err) {
        if (win) win.close();
        console.error("[résumé]", err);
        say("The résumé couldn't be fetched right now. Email lumahi@proton.me and I'll send a copy.");
      } finally {
        button.textContent = label;
        buttons.forEach((b) => { b.disabled = false; b.removeAttribute("aria-busy"); });
        busy = false;
      }
    }
    buttons.forEach((b) => b.addEventListener("click", () => run(b)));
  })();

  /* ---------------- AutoPickup videos ---------------- */
  (function videos() {
    const vids = [...document.querySelectorAll("#autopickup video")];
    let visible = false;
    const sync = () => vids.forEach((v) => {
      const shown = !v.closest(".panel").hidden;
      if (shown && visible && !reduceMotion) { v.play().catch(() => {}); } else { v.pause(); }
      if (reduceMotion) v.controls = true;
    });
    tabListeners.push((root) => { if (root.closest("#autopickup")) sync(); });
    const screen = document.querySelector("#autopickup .screen");
    if (screen) onScreen(screen, (v) => { visible = v; sync(); });
  })();

  /* ---------------- live download counts ---------------- */
  (function liveDownloads() {
    const nodes = [...document.querySelectorAll("[data-live]")];
    if (!nodes.length) return;
    const MODRINTH = "https://api.modrinth.com/v2/project/simple-autopickup";
    const CURSEFORGE = "https://api.cfwidget.com/1309048"; // public CurseForge mirror; the official API needs a private key
    const fmt = (n) => n.toLocaleString("en-US");
    const of = (key) => nodes.filter((el) => el.dataset.live === key);
    const shown = (key) => {
      const el = of(key)[0];
      return el ? Number(el.textContent.replace(/[^\d]/g, "")) || 0 : 0;
    };
    const put = (key, text, note) => of(key).forEach((el) => { el.textContent = text; if (note) el.title = note; });
    const getJson = async (url) => {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`${url} answered ${res.status}`);
      return res.json();
    };

    Promise.allSettled([getJson(MODRINTH), getJson(CURSEFORGE), getJson(`${MODRINTH}/version`)]).then(([mr, cf, rel]) => {
      const when = new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
      // Download counts only grow; never let a stale mirror show less than the page already does.
      let modrinth = shown("modrinth"), curse = shown("curseforge"), live = false;
      if (mr.status === "fulfilled" && Number.isFinite(mr.value.downloads)) {
        modrinth = Math.max(modrinth, mr.value.downloads); live = true;
        put("modrinth", fmt(modrinth), `Live from Modrinth, ${when}`);
      }
      // The project's own game_versions is the union of every release ever uploaded, including
      // old Fabric-only builds (1.20.x, 1.21.2-8) that current releases no longer cover. Count only
      // the builds of the newest mod version (the part of version_number before "+").
      if (rel.status === "fulfilled" && Array.isArray(rel.value) && rel.value.length) {
        const newest = rel.value.reduce((a, b) => (a.date_published > b.date_published ? a : b));
        const current = rel.value.filter((v) => v.version_number.split("+")[0] === newest.version_number.split("+")[0]);
        const games = new Set(current.flatMap((v) => v.game_versions || []));
        const loaders = new Set(current.flatMap((v) => v.loaders || []));
        const note = `Live from Modrinth, ${newest.version_number.split("+")[0]} builds, ${when}`;
        if (games.size) put("versions", String(games.size), note);
        if (loaders.size) put("loaders", String(loaders.size), note);
      }
      if (cf.status === "fulfilled" && Number.isFinite(cf.value?.downloads?.total)) {
        curse = Math.max(curse, cf.value.downloads.total); live = true;
        put("curseforge", fmt(curse), `Live from CurseForge (via CFWidget), ${when}`);
      }
      if (!live) return;
      const total = modrinth + curse;
      put("total", fmt(Math.max(total, shown("total"))), `Modrinth + CurseForge, live ${when}`);
      put("total-floor", fmt(Math.floor(total / 1000) * 1000));
    });
  })();

  /* ---------------- Downloads chart ---------------- */
  (function chart() {
    // Fallback snapshot (Modrinth CSV export, 2026-09-15). data/modrinth-downloads.json replaces it
    // when present; a scheduled GitHub Action refreshes that file from Modrinth analytics.
    let data = [["2025-05-29",1],["2025-06-05",30],["2025-06-12",60],["2025-06-19",84],["2025-06-26",81],["2025-07-03",123],["2025-07-10",138],["2025-07-18",145],["2025-07-25",111],["2025-08-01",163],["2025-08-08",186],["2025-08-15",185],["2025-08-22",214],["2025-08-29",196],["2025-09-05",212],["2025-09-12",228],["2025-09-19",224],["2025-09-26",226],["2025-10-03",231],["2025-10-10",319],["2025-10-17",265],["2025-10-25",268],["2025-11-01",269],["2025-11-08",286],["2025-11-15",298],["2025-11-22",254],["2025-11-29",328],["2025-12-06",241],["2025-12-13",284],["2025-12-20",296],["2025-12-27",535],["2026-01-03",514],["2026-01-10",474],["2026-01-17",446],["2026-01-24",590],["2026-01-31",504],["2026-02-08",605],["2026-02-15",660],["2026-02-22",626],["2026-03-01",733],["2026-03-08",634],["2026-03-15",622],["2026-03-22",662],["2026-03-29",719],["2026-04-05",724],["2026-04-12",811],["2026-04-19",672],["2026-04-26",473],["2026-05-03",669],["2026-05-10",690],["2026-05-18",799],["2026-05-25",945],["2026-06-01",1143],["2026-06-08",1231],["2026-06-15",932],["2026-06-22",1221],["2026-06-29",1013],["2026-07-06",947],["2026-07-13",1069],["2026-07-20",1129],["2026-07-27",1116],["2026-08-03",1125],["2026-08-10",1221],["2026-08-17",2021],["2026-08-25",4827],["2026-09-01",7148],["2026-09-08",8120]]
      .map(([d, v]) => ({ d: new Date(d + "T00:00:00"), v }));
    const host = document.getElementById("dl-chart");
    const tip = document.getElementById("dl-tip");
    const tbody = document.querySelector("#dl-table tbody");
    const caption = document.getElementById("dl-caption");
    const fmtDate = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const fillTable = () => { tbody.innerHTML = data.slice().reverse().map((p) => `<tr><td>${fmtDate(p.d)}</td><td>${p.v.toLocaleString()}</td></tr>`).join(""); };
    fillTable();

    const NS = "http://www.w3.org/2000/svg";
    const el = (tag, attrs, parent) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); if (parent) parent.appendChild(n); return n; };

    function render() {
      const W = Math.max(300, host.clientWidth), small = W < 560;
      const H = small ? 240 : 300;
      const m = { t: 28, r: small ? 12 : 64, b: 30, l: 44 };
      const iw = W - m.l - m.r, ih = H - m.t - m.b;
      const t0 = data[0].d.getTime(), t1 = data[data.length - 1].d.getTime();
      const peakValue = Math.max(...data.map((p) => p.v), 1);
      const step = [500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000].find((s) => peakValue / s <= 5) ?? 100000;
      const yMax = Math.ceil((peakValue * 1.1) / step) * step;
      const X = (d) => m.l + ((d.getTime() - t0) / (t1 - t0)) * iw;
      const Y = (v) => m.t + ih - (v / yMax) * ih;
      host.innerHTML = "";
      const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", "aria-label": `Line chart of weekly Modrinth downloads from ${fmtDate(data[0].d)} to ${fmtDate(data[data.length - 1].d)}, peaking at ${peakValue.toLocaleString()} a week.` }, host);
      const ink = css("--legend"), muted = css("--legend-dim"), rule = "rgba(80, 170, 255, 0.14)", accent = css("--neon");

      for (let v = 0; v <= yMax; v += step) {
        el("line", { x1: m.l, x2: m.l + iw, y1: Y(v), y2: Y(v), stroke: rule, "stroke-width": v === 0 ? 1.25 : 1 }, svg);
        const t = el("text", { x: m.l - 8, y: Y(v) + 4, "text-anchor": "end", fill: muted, "font-size": 11, "font-family": "Martian Mono, monospace" }, svg);
        t.textContent = v === 0 ? "0" : v >= 1000 ? `${+(v / 1000).toFixed(1)}k` : String(v);
      }
      const months = [];
      for (let d = new Date(data[0].d.getFullYear(), data[0].d.getMonth() + 1, 1); d.getTime() <= t1; d = new Date(d.getFullYear(), d.getMonth() + 3, 1)) months.push(d);
      let lastYear = null;
      months.forEach((d) => {
        if (d.getTime() < t0 || d.getTime() > t1) return;
        const showYear = d.getFullYear() !== lastYear; lastYear = d.getFullYear();
        const x = X(d);
        el("line", { x1: x, x2: x, y1: m.t + ih, y2: m.t + ih + 5, stroke: muted, "stroke-width": 1 }, svg);
        const t = el("text", { x, y: m.t + ih + 20, "text-anchor": "middle", fill: muted, "font-size": 11, "font-family": "Martian Mono, monospace" }, svg);
        t.textContent = showYear ? d.toLocaleDateString("en-US", { month: "short", year: "numeric" }) : d.toLocaleDateString("en-US", { month: "short" });
      });

      const line = data.map((p, i) => `${i ? "L" : "M"}${X(p.d).toFixed(1)},${Y(p.v).toFixed(1)}`).join("");
      el("path", { d: `${line}L${X(data[data.length - 1].d)},${Y(0)}L${X(data[0].d)},${Y(0)}Z`, fill: accent, "fill-opacity": 0.12, stroke: "none" }, svg);
      el("path", { d: line, fill: "none", stroke: accent, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);

      const peak = data.reduce((a, b) => (b.v > a.v ? b : a));
      el("circle", { cx: X(peak.d), cy: Y(peak.v), r: 4.5, fill: accent, stroke: css("--crt"), "stroke-width": 2 }, svg);
      const pl = el("text", { x: X(peak.d) - 10, y: Y(peak.v) - 10, "text-anchor": "end", fill: ink, "font-size": 12, "font-family": "Martian Mono, monospace", "font-weight": 500 }, svg);
      pl.textContent = `${peak.v.toLocaleString()} / week`;
      const early = data.find((p) => p.d.getFullYear() === 2025 && p.d.getMonth() === 11 && p.d.getDate() > 20);
      if (early && !small) {
        const el2 = el("text", { x: X(early.d), y: Y(early.v) - 12, "text-anchor": "middle", fill: muted, "font-size": 11, "font-family": "Martian Mono, monospace" }, svg);
        el2.textContent = `${early.v} / week`;
      }

      const cross = el("line", { y1: m.t, y2: m.t + ih, stroke: muted, "stroke-width": 1, "stroke-dasharray": "3 3", visibility: "hidden" }, svg);
      const dot = el("circle", { r: 4.5, fill: accent, stroke: css("--crt"), "stroke-width": 2, visibility: "hidden" }, svg);
      const hit = el("rect", { x: m.l, y: m.t, width: iw, height: ih, fill: "transparent" }, svg);
      const move = (clientX) => {
        const rect = svg.getBoundingClientRect();
        const x = (clientX - rect.left) * (W / rect.width);
        let best = data[0], bd = Infinity;
        data.forEach((p) => { const dd = Math.abs(X(p.d) - x); if (dd < bd) { bd = dd; best = p; } });
        const px = X(best.d), py = Y(best.v);
        cross.setAttribute("x1", px); cross.setAttribute("x2", px); cross.setAttribute("visibility", "visible");
        dot.setAttribute("cx", px); dot.setAttribute("cy", py); dot.setAttribute("visibility", "visible");
        tip.hidden = false;
        tip.innerHTML = `${fmtDate(best.d)}<br><b>${best.v.toLocaleString()}</b> downloads`;
        const scale = rect.width / W;
        tip.style.left = `${Math.min(Math.max(px * scale, 70), rect.width - 70)}px`;
        tip.style.top = `${py * scale - 12}px`;
      };
      const leave = () => { cross.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); tip.hidden = true; };
      hit.addEventListener("pointermove", (e) => move(e.clientX));
      hit.addEventListener("pointerdown", (e) => move(e.clientX));
      hit.addEventListener("pointerleave", leave);
    }
    render();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(render);
    let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(render, 120); });

    fetch("data/modrinth-downloads.json", { cache: "no-cache" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        const weeks = json && Array.isArray(json.weeks) ? json.weeks.filter((w) => /^\d{4}-\d{2}-\d{2}$/.test(w.start) && Number.isFinite(w.downloads)) : [];
        if (weeks.length < 4) return;
        data = weeks.map((w) => ({ d: new Date(w.start + "T00:00:00"), v: w.downloads }));
        fillTable();
        render();
        const latest = data[data.length - 1];
        document.querySelectorAll('[data-live="latest-week"]').forEach((node) => {
          node.textContent = latest.v.toLocaleString("en-US");
          node.title = `Week of ${fmtDate(latest.d)}, from Modrinth analytics`;
        });
        if (caption && json.through) {
          const through = new Date(json.through + "T00:00:00");
          through.setDate(through.getDate() - 1);
          caption.textContent = `Weekly downloads from Modrinth analytics, full weeks through ${fmtDate(through)}, refreshed daily. CurseForge downloads are not included here.`;
        }
      })
      .catch(() => {});
  })();
})();
