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

  /* ---------------- Defense Simulation: in-browser build ---------------- */
  (function playSim() {
    const stage = document.getElementById("ds-play");
    const btn = document.getElementById("ds-play-btn");
    if (!stage || !btn) return;
    // Load on demand: the wasm build and city map are about 5 MB.
    btn.addEventListener("click", () => {
      const frame = document.createElement("iframe");
      frame.src = "play/defense-simulation/";
      frame.title = "Defense Simulation, running in the browser";
      frame.allow = "fullscreen";
      frame.allowFullscreen = true;
      stage.replaceChildren(frame);
      frame.focus();
    });
  })();

  /* ---------------- Defense Simulation clip reel ---------------- */
  (function clipReel() {
    const video = document.getElementById("ds-reel");
    const cap = document.getElementById("ds-reel-cap");
    if (!video || !cap) return;
    const buttons = [...document.querySelectorAll("[data-clip]")];
    let current = 0;
    const show = (i, play) => {
      current = (i + buttons.length) % buttons.length;
      const b = buttons[current];
      buttons.forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      video.src = `${b.dataset.clip}.mp4`;
      video.poster = `${b.dataset.clip}.jpg`;
      video.setAttribute("aria-label", b.dataset.alt);
      const strong = document.createElement("strong");
      strong.textContent = b.dataset.title;
      cap.replaceChildren(strong, ` ${b.dataset.text}`);
      if (play) video.play().catch(() => {});
    };
    buttons.forEach((b, i) => b.addEventListener("click", () => show(i, !reduceMotion)));
    // Play the reel straight through, wrapping back to the first clip.
    video.addEventListener("ended", () => show(current + 1, !reduceMotion));
  })();

  /* ---------------- tabbed videos (Defense Simulation, AutoPickup) ---------------- */
  document.querySelectorAll(".screen").forEach((screen) => {
    const vids = [...screen.querySelectorAll("video")];
    if (!vids.length) return;
    let visible = false;
    const sync = () => vids.forEach((v) => {
      const shown = !v.closest(".panel").hidden;
      if (shown && visible && !reduceMotion) { v.play().catch(() => {}); } else { v.pause(); }
      if (reduceMotion) v.controls = true;
    });
    tabListeners.push((root) => { if (root === screen) sync(); });
    onScreen(screen, (v) => { visible = v; sync(); });
  });

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
    // Each point: d (week start), v (Modrinth), and once data/curseforge-weekly.json loads, cf and est (CurseForge, estimated).
    const cfText = (p) => (p.cf == null ? "n/a" : `${p.cf.toLocaleString()}${p.est ? " (est.)" : ""}`);
    const fillTable = () => { tbody.innerHTML = data.slice().reverse().map((p) => `<tr><td>${fmtDate(p.d)}</td><td>${p.v.toLocaleString()}</td><td>${cfText(p)}</td></tr>`).join(""); };
    fillTable();

    const NS = "http://www.w3.org/2000/svg";
    const el = (tag, attrs, parent) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); if (parent) parent.appendChild(n); return n; };

    function render() {
      const W = Math.max(300, host.clientWidth), small = W < 560;
      const H = small ? 240 : 300;
      const m = { t: 28, r: small ? 12 : 64, b: 30, l: 44 };
      const iw = W - m.l - m.r, ih = H - m.t - m.b;
      const t0 = data[0].d.getTime(), t1 = data[data.length - 1].d.getTime();
      const hasCf = data.some((p) => p.cf != null);
      const peak = data.reduce((a, b) => (b.v > a.v ? b : a));
      const cfPeak = hasCf ? data.reduce((a, b) => ((b.cf ?? 0) > (a.cf ?? 0) ? b : a)) : null;
      const peakValue = Math.max(peak.v, cfPeak ? cfPeak.cf : 0, 1);
      const step = [500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000].find((s) => peakValue / s <= 5) ?? 100000;
      const yMax = Math.ceil((peakValue * 1.1) / step) * step;
      const X = (d) => m.l + ((d.getTime() - t0) / (t1 - t0)) * iw;
      const Y = (v) => m.t + ih - (v / yMax) * ih;
      host.innerHTML = "";
      const label = `Line chart of weekly downloads from ${fmtDate(data[0].d)} to ${fmtDate(data[data.length - 1].d)}. Modrinth peaks at ${peak.v.toLocaleString()} a week` +
        (cfPeak ? `; CurseForge, overlaid, peaks at ${cfPeak.cf.toLocaleString()}.` : ".");
      const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", "aria-label": label }, host);
      const ink = css("--legend"), muted = css("--legend-dim"), rule = "rgba(80, 170, 255, 0.14)", accent = css("--neon"), amber = css("--ghost");

      for (let v = 0; v <= yMax; v += step) {
        el("line", { x1: m.l, x2: m.l + iw, y1: Y(v), y2: Y(v), stroke: rule, "stroke-width": v === 0 ? 1.25 : 1 }, svg);
        const t = el("text", { x: m.l - 8, y: Y(v) + 4, "text-anchor": "end", fill: muted, "font-size": 11, "font-family": "Merriweather, Georgia, serif" }, svg);
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
        const t = el("text", { x, y: m.t + ih + 20, "text-anchor": "middle", fill: muted, "font-size": 11, "font-family": "Merriweather, Georgia, serif" }, svg);
        t.textContent = showYear ? d.toLocaleDateString("en-US", { month: "short", year: "numeric" }) : d.toLocaleDateString("en-US", { month: "short" });
      });

      // Both series drawn from zero; CurseForge is overlaid (dotted), not stacked.
      const path = (key) => data.map((p, i) => `${i ? "L" : "M"}${X(p.d).toFixed(1)},${Y(p[key] ?? 0).toFixed(1)}`).join("");
      const base = `L${X(data[data.length - 1].d)},${Y(0)}L${X(data[0].d)},${Y(0)}Z`;
      const line = path("v");
      el("path", { d: line + base, fill: accent, "fill-opacity": 0.12, stroke: "none" }, svg);
      if (hasCf) {
        const cfLine = path("cf");
        el("path", { d: cfLine + base, fill: amber, "fill-opacity": 0.1, stroke: "none" }, svg);
        el("path", { d: line, fill: "none", stroke: accent, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
        el("path", { d: cfLine, fill: "none", stroke: amber, "stroke-width": 2, "stroke-dasharray": "1.5 4", "stroke-linecap": "round" }, svg);
      } else {
        el("path", { d: line, fill: "none", stroke: accent, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
      }

      // Legend, top left.
      [["Modrinth", accent, null], ...(hasCf ? [["CurseForge", amber, "1.5 4"]] : [])].reduce((x, [name, color, dash]) => {
        el("line", { x1: x, x2: x + 16, y1: 11, y2: 11, stroke: color, "stroke-width": 2.5, "stroke-linecap": "round", ...(dash ? { "stroke-dasharray": dash } : {}) }, svg);
        const t = el("text", { x: x + 22, y: 15, fill: muted, "font-size": 11, "font-family": "Merriweather, Georgia, serif" }, svg);
        t.textContent = name;
        return x + 22 + name.length * 7.5 + 18;
      }, m.l);

      el("circle", { cx: X(peak.d), cy: Y(peak.v), r: 4.5, fill: accent, stroke: css("--crt"), "stroke-width": 2 }, svg);
      const pl = el("text", { x: X(peak.d) - 10, y: Y(peak.v) - 10, "text-anchor": "end", fill: ink, "font-size": 12, "font-family": "Merriweather, Georgia, serif", "font-weight": 500 }, svg);
      pl.textContent = `${peak.v.toLocaleString()} / week`;
      if (cfPeak) {
        const cx = X(cfPeak.d), cy = Y(cfPeak.cf), right = cx + 90 < W;
        el("circle", { cx, cy, r: 3.5, fill: amber, stroke: css("--crt"), "stroke-width": 2 }, svg);
        // On narrow screens the label lands on both lines; the dot and tooltip are enough there.
        const cl = small ? null : el("text", { x: right ? cx + 8 : cx - 8, y: cy + 18, "text-anchor": right ? "start" : "end", fill: ink, "font-size": 12, "font-family": "Merriweather, Georgia, serif", "font-weight": 500 }, svg);
        if (cl) cl.textContent = cfPeak.cf.toLocaleString();
      }
      const early = data.find((p) => p.d.getFullYear() === 2025 && p.d.getMonth() === 11 && p.d.getDate() > 20);
      if (early && !small) {
        const el2 = el("text", { x: X(early.d), y: Y(early.v) - 12, "text-anchor": "middle", fill: muted, "font-size": 11, "font-family": "Merriweather, Georgia, serif" }, svg);
        el2.textContent = `${early.v} / week`;
      }

      const cross = el("line", { y1: m.t, y2: m.t + ih, stroke: muted, "stroke-width": 1, "stroke-dasharray": "3 3", visibility: "hidden" }, svg);
      const dot = el("circle", { r: 4.5, fill: accent, stroke: css("--crt"), "stroke-width": 2, visibility: "hidden" }, svg);
      const cfDot = el("circle", { r: 3.5, fill: amber, stroke: css("--crt"), "stroke-width": 2, visibility: "hidden" }, svg);
      const hit = el("rect", { x: m.l, y: m.t, width: iw, height: ih, fill: "transparent" }, svg);
      const move = (clientX) => {
        const rect = svg.getBoundingClientRect();
        const x = (clientX - rect.left) * (W / rect.width);
        let best = data[0], bd = Infinity;
        data.forEach((p) => { const dd = Math.abs(X(p.d) - x); if (dd < bd) { bd = dd; best = p; } });
        const px = X(best.d), py = Y(best.v);
        cross.setAttribute("x1", px); cross.setAttribute("x2", px); cross.setAttribute("visibility", "visible");
        dot.setAttribute("cx", px); dot.setAttribute("cy", py); dot.setAttribute("visibility", "visible");
        if (best.cf != null) { cfDot.setAttribute("cx", px); cfDot.setAttribute("cy", Y(best.cf)); cfDot.setAttribute("visibility", "visible"); }
        else cfDot.setAttribute("visibility", "hidden");
        tip.hidden = false;
        tip.innerHTML = best.cf == null
          ? `${fmtDate(best.d)}<br><b>${best.v.toLocaleString()}</b> downloads`
          : `${fmtDate(best.d)}<br><b>${best.v.toLocaleString()}</b> Modrinth<br><b>${cfText(best)}</b> CurseForge`;
        const scale = rect.width / W;
        tip.style.left = `${Math.min(Math.max(px * scale, 70), rect.width - 70)}px`;
        tip.style.top = `${py * scale - 12}px`;
      };
      const leave = () => { cross.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); cfDot.setAttribute("visibility", "hidden"); tip.hidden = true; };
      hit.addEventListener("pointermove", (e) => move(e.clientX));
      hit.addEventListener("pointerdown", (e) => move(e.clientX));
      hit.addEventListener("pointerleave", leave);
    }
    render();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(render);
    let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(render, 120); });

    // CurseForge has no analytics API, so data/curseforge-weekly.json is rebuilt by hand from scraped
    // exports (see linkedin/README.md in the parent folder). Weeks it doesn't cover show as n/a.
    const getWeeks = (url) => fetch(url, { cache: "no-cache" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => (json && Array.isArray(json.weeks) ? { json, weeks: json.weeks.filter((w) => /^\d{4}-\d{2}-\d{2}$/.test(w.start) && Number.isFinite(w.downloads)) } : null))
      .catch(() => null);
    Promise.all([getWeeks("data/modrinth-downloads.json"), getWeeks("data/curseforge-weekly.json")]).then(([mr, cf]) => {
      if (!mr || mr.weeks.length < 4) return;
      const cfByWeek = new Map((cf ? cf.weeks : []).map((w) => [w.start, w]));
      data = mr.weeks.map((w) => {
        const c = cfByWeek.get(w.start);
        return { d: new Date(w.start + "T00:00:00"), v: w.downloads, cf: c ? c.downloads : null, est: !!(c && c.estimated) };
      });
      fillTable();
      render();
      const latest = data[data.length - 1];
      document.querySelectorAll('[data-live="latest-week"]').forEach((node) => {
        node.textContent = latest.v.toLocaleString("en-US");
        node.title = `Week of ${fmtDate(latest.d)}, from Modrinth analytics`;
      });
      if (caption && mr.json.through) {
        const through = new Date(mr.json.through + "T00:00:00");
        through.setDate(through.getDate() - 1);
        const firstExport = cf && cf.json.first_exported_day ? fmtDate(new Date(cf.json.first_exported_day + "T00:00:00")) : null;
        caption.textContent = cf
          ? `Weekly downloads from Modrinth analytics (refreshed daily) and CurseForge's author stats (updated by hand), full weeks through ${fmtDate(through)}.${firstExport ? ` CurseForge weeks before ${firstExport} are estimated.` : ""}`
          : `Weekly downloads from Modrinth analytics, full weeks through ${fmtDate(through)}, refreshed daily. CurseForge downloads are not included here.`;
      }
    });
  })();
})();
