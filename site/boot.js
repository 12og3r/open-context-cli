/* ============================================================
   openctx — boot.js (Round 3)
   3D opener · WAAPI orchestration · CSS 3D transforms · no deps
   Phases (desktop, 6.0s total):
     0.0–0.5s  HOOK    blue caret rushes forward from z=-3000
     0.5–1.2s  BURST   caret detonates into 7 letterforms + 8 fragments
     1.2–2.8s  ASSEMBLE  glyphs fly to logotype, camera dollies
     2.8–3.3s  THUNK   micro-bounce + halo + underline sweep
     3.3–4.5s  SCATTER  logotype docks top-left, page rises
     4.5–6.0s  SETTLE   TUI fades in, will-change released, startSite()
   Mobile (≤640): 4.0s, no per-glyph blur, no camera dolly.
   Tiny (<480) / reduced-motion / saveData / sessionStorage / ?noboot: skipped.
   ============================================================ */
(function () {
  'use strict';

  const HAS_SESSION  = (() => { try { return !!sessionStorage.getItem('octx_booted_r3'); } catch { return false; } })();
  const PREFERS_RM   = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SAVE_DATA    = !!(navigator.connection && navigator.connection.saveData);
  const NOBOOT_PARAM = location.search.includes('noboot');
  const FORCE_BOOT   = /[?&]boot(?:=|&|$)/.test(location.search) || location.search.endsWith('?boot');
  const IS_TINY      = matchMedia('(max-width: 480px)').matches;
  const IS_MOBILE    = matchMedia('(max-width: 640px)').matches;

  // ?boot in the URL bypasses every skip rule (handy for previewing the intro).
  // Otherwise, skip if sessionStorage already saw it OR user prefers reduced
  // motion OR data-saver OR ?noboot OR viewport too tiny.
  const SHOULD_SKIP = !FORCE_BOOT && (HAS_SESSION || PREFERS_RM || SAVE_DATA || NOBOOT_PARAM || IS_TINY);

  // ────── shared state — declared before any branch to avoid TDZ on
  // listener callbacks that fire after this IIFE has returned. ──────
  let ctrl;
  let finished = false;
  const tracked = new Set();

  if (SHOULD_SKIP) {
    // Mark the html element synchronously so CSS can hide the boot overlay AND
    // restore main visibility before the body is even parsed. Prevents a flash
    // of dark/blank screen between body parse and DOMContentLoaded.
    document.documentElement.classList.add('boot-skip');
    if (document.readyState !== 'loading') instantFinish();
    else document.addEventListener('DOMContentLoaded', instantFinish, { once: true });
    return;
  }

  // Timeline (ms). Mobile is a compressed variant.
  // SETTLE is short — the page is already visible halfway through SCATTER, so
  // settle is just a small buffer before finish() removes the overlay.
  const T = IS_MOBILE
    ? { hook: 400,  burst: 700,  assemble: 1100, thunk: 350, scatter: 850, settle: 200,
        end:  3600, useDolly: false, useGlyphBlur: false, fragCount: 5 }
    : { hook: 500,  burst: 700,  assemble: 1600, thunk: 500, scatter: 1200, settle: 350,
        end:  4850, useDolly: true, useGlyphBlur: true, fragCount: 8 };

  // Phase boundaries derived
  T.b0 = 0;
  T.b1 = T.b0 + T.hook;
  T.b2 = T.b1 + T.burst;
  T.b3 = T.b2 + T.assemble;
  T.b4 = T.b3 + T.thunk;
  T.b5 = T.b4 + T.scatter;
  T.b6 = T.b5 + T.settle;

  if (document.readyState !== 'loading') start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
  function track(a) {
    tracked.add(a);
    if (a.finished) a.finished.finally(() => tracked.delete(a));
    return a;
  }
  function cancelAll() {
    tracked.forEach(a => { try { a.cancel(); } catch {} });
    tracked.clear();
  }

  async function start() {
    const overlay  = document.getElementById('boot');
    const stage    = document.getElementById('boot-stage');
    const caret    = document.getElementById('boot-caret');
    const logoEl   = document.getElementById('boot-logotype');
    const rainEl   = document.getElementById('boot-rain');
    const halo     = document.getElementById('boot-halo');
    const underline = document.getElementById('boot-underline');
    const skipBtn  = document.getElementById('boot-skip');
    if (!overlay || !stage || !caret) return instantFinish();

    // Build the 7 letterform glyphs
    const letters = buildLetters('openctx', logoEl);
    // Build 8 timestamp fragments
    const fragments = buildFragments(T.fragCount, rainEl);

    // Race font readiness — but we don't block beyond 200ms
    const fontPromise = (document.fonts && document.fonts.load)
      ? document.fonts.load('italic 500 100px "Fraunces"').catch(() => null)
      : Promise.resolve(null);
    await Promise.race([fontPromise, sleep(200)]);

    // Skip handlers
    ctrl = new AbortController();
    const onSkip = (e) => {
      if (e && e.type === 'keydown' && e.key !== 'Escape') return;
      e && e.preventDefault();
      if (!finished) finish(overlay);
    };
    skipBtn.addEventListener('click', onSkip);
    overlay.addEventListener('pointerdown', onSkip);
    document.addEventListener('keydown', onSkip);
    ctrl.signal.addEventListener('abort', () => { cancelAll(); });

    try {
      await phaseHook(caret);
      if (finished) return;
      await phaseBurst(caret, letters, fragments);
      if (finished) return;
      await phaseAssemble(letters, fragments, stage);
      if (finished) return;
      await phaseThunk(letters, halo, underline);
      if (finished) return;
      await phaseScatter(letters, fragments, halo, underline, stage);
      if (finished) return;
      await phaseSettle();
    } catch (e) { /* swallow */ }

    if (!finished) finish(overlay);
  }

  // ────────────────────────────────────────────────────────────
  // PHASE 1 — HOOK (caret rushes forward)
  // ────────────────────────────────────────────────────────────
  async function phaseHook(caret) {
    const a = track(caret.animate(
      [
        { transform: 'translate(-50%, -50%) translateZ(-3000px) rotateY(0deg) scale(.3)', opacity: 0 },
        { transform: 'translate(-50%, -50%) translateZ(-1200px) rotateY(180deg) scale(.6)', opacity: 1, offset: 0.4 },
        { transform: 'translate(-50%, -50%) translateZ(-200px) rotateY(540deg) scale(1.2)', opacity: 1 },
      ],
      { duration: T.hook, easing: 'cubic-bezier(.16, 1, .3, 1)', fill: 'forwards' }
    ));
    await a.finished.catch(() => {});
  }

  // ────────────────────────────────────────────────────────────
  // PHASE 2 — BURST (caret detonates into letters + fragments)
  // ────────────────────────────────────────────────────────────
  async function phaseBurst(caret, letters, fragments) {
    // Caret fades, scales up briefly (the explosion flash)
    track(caret.animate(
      [
        { transform: 'translate(-50%, -50%) translateZ(-200px) rotateY(540deg) scale(1.2)', opacity: 1 },
        { transform: 'translate(-50%, -50%) translateZ(0) rotateY(540deg) scale(2.6)', opacity: .6, offset: 0.3 },
        { transform: 'translate(-50%, -50%) translateZ(80px) rotateY(540deg) scale(.2)', opacity: 0 },
      ],
      { duration: T.burst, easing: 'cubic-bezier(.7, 0, .2, 1)', fill: 'forwards' }
    ));

    // Letters spawn at random positions (will fly home during ASSEMBLE)
    letters.forEach((el) => {
      const init = el._init;
      el.style.transform = `translate(-50%, -50%) translate(${init.x}px, ${init.y}px) translateZ(${init.z}px) rotateX(${init.rx}deg) rotateY(${init.ry}deg)`;
      el.animate(
        [{ opacity: 0 }, { opacity: 1 }],
        { duration: 320, easing: 'ease-out', fill: 'forwards' }
      );
    });

    // Fragments tumble in
    fragments.forEach((el, i) => {
      const init = el._init;
      el.style.transform = `translate(-50%, -50%) translate(${init.x}px, ${init.y}px) translateZ(${init.z}px) rotateX(${init.rx}deg) rotateY(${init.ry}deg)`;
      track(el.animate(
        [{ opacity: 0 }, { opacity: .85 }],
        { duration: 280 + i * 30, easing: 'ease-out', fill: 'forwards' }
      ));
    });

    await sleep(T.burst);
  }

  // ────────────────────────────────────────────────────────────
  // PHASE 3 — ASSEMBLE (letters fly to logotype, camera dollies)
  // ────────────────────────────────────────────────────────────
  async function phaseAssemble(letters, fragments, stage) {
    // Camera dolly + slight pan (only desktop)
    if (T.useDolly) {
      track(stage.animate(
        [
          { transform: 'translateZ(0) rotateY(-3deg)' },
          { transform: 'translateZ(80px) rotateY(0deg)' },
        ],
        { duration: T.assemble, easing: 'cubic-bezier(.4, 0, .2, 1)', fill: 'forwards' }
      ));
    }

    // Letters: 90ms stagger, fly home along curved path
    const stagger = T.useDolly ? 90 : 50;
    const flightDuration = Math.max(700, T.assemble - stagger * letters.length);
    const blurEnabled = T.useGlyphBlur;

    const flights = letters.map((el, i) => {
      const init = el._init;
      const finalX = el._finalX;
      const startFilter = blurEnabled ? 'blur(12px)' : 'none';
      const endFilter   = 'blur(0)';
      const a = track(el.animate(
        [
          {
            transform: `translate(-50%, -50%) translate(${init.x}px, ${init.y}px) translateZ(${init.z}px) rotateX(${init.rx}deg) rotateY(${init.ry}deg)`,
            filter: startFilter,
            opacity: 1,
          },
          {
            transform: `translate(-50%, -50%) translate(${finalX}px, 0) translateZ(0) rotateX(0) rotateY(0)`,
            filter: endFilter,
            opacity: 1,
          },
        ],
        { duration: flightDuration, delay: i * stagger, easing: 'cubic-bezier(.16, 1.1, .3, 1)', fill: 'forwards' }
      ));
      return a.finished.catch(() => {});
    });

    // Fragments: continue tumbling but lighter — they're decoration
    fragments.forEach((el, i) => {
      const init = el._init;
      track(el.animate(
        [
          { transform: `translate(-50%, -50%) translate(${init.x}px, ${init.y}px) translateZ(${init.z}px) rotateX(${init.rx}deg) rotateY(${init.ry}deg)`, opacity: .85 },
          { transform: `translate(-50%, -50%) translate(${init.x * .4}px, ${init.y * .4}px) translateZ(${init.z * .3}px) rotateX(${init.rx * .3}deg) rotateY(${init.ry * .3}deg)`, opacity: .55 },
        ],
        { duration: T.assemble, easing: 'cubic-bezier(.4, 0, .2, 1)', fill: 'forwards' }
      ));
    });

    await Promise.all(flights);
  }

  // ────────────────────────────────────────────────────────────
  // PHASE 4 — THUNK (micro-bounce + halo + underline sweep)
  // ────────────────────────────────────────────────────────────
  async function phaseThunk(letters, halo, underline) {
    // Halo flash
    track(halo.animate(
      [
        { opacity: 0, transform: 'translate(-50%, -50%) scale(.3)' },
        { opacity: .9, transform: 'translate(-50%, -50%) scale(1.2)', offset: 0.2 },
        { opacity: 0, transform: 'translate(-50%, -50%) scale(1.8)' },
      ],
      { duration: T.thunk, easing: 'cubic-bezier(.16, 1, .3, 1)', fill: 'forwards' }
    ));

    // L→R underline sweep
    track(underline.animate(
      [
        { width: '0px', opacity: 0 },
        { width: '120px', opacity: 1, offset: 0.4 },
        { width: '320px', opacity: .6 },
      ],
      { duration: T.thunk, easing: 'cubic-bezier(.22, .61, .36, 1)', fill: 'forwards' }
    ));

    // Letters micro-bounce
    letters.forEach((el, i) => {
      const finalX = el._finalX;
      track(el.animate(
        [
          { transform: `translate(-50%, -50%) translate(${finalX}px, 0) scale(1)` },
          { transform: `translate(-50%, -50%) translate(${finalX}px, -3px) scale(1.025)`, offset: 0.3 },
          { transform: `translate(-50%, -50%) translate(${finalX}px, 0) scale(1)` },
        ],
        { duration: T.thunk * .8, delay: i * 12, easing: 'ease-out', fill: 'forwards' }
      ));
    });

    await sleep(T.thunk);
  }

  // ────────────────────────────────────────────────────────────
  // PHASE 5 — SCATTER (logotype docks top-left, page rises)
  // ────────────────────────────────────────────────────────────
  async function phaseScatter(letters, fragments, halo, underline, stage) {
    // Halo fades fully
    track(halo.animate([{ opacity: 0 }, { opacity: 0 }], { duration: 50, fill: 'forwards' }));
    // Underline fades
    track(underline.animate([{ opacity: .6 }, { opacity: 0 }], { duration: 300, fill: 'forwards' }));

    // Fragments scatter outward + fade
    fragments.forEach((el) => {
      const init = el._init;
      track(el.animate(
        [
          { opacity: .55, transform: `translate(-50%, -50%) translate(${init.x * .4}px, ${init.y * .4}px) translateZ(${init.z * .3}px)` },
          { opacity: 0,   transform: `translate(-50%, -50%) translate(${init.x * 1.5}px, ${init.y * 1.5}px) translateZ(400px) rotateY(180deg)` },
        ],
        { duration: T.scatter, easing: 'cubic-bezier(.7, 0, .2, 1)', fill: 'forwards' }
      ));
    });

    // Measure the real hero wordmark — that's where the logotype will dock.
    // The page is visibility:hidden during boot but the layout is computed, so
    // getBoundingClientRect works.
    let targetScale = 0.55, targetX = -window.innerWidth * 0.28, targetY = -window.innerHeight * 0.32;
    const wordmark = document.querySelector('.hero__wordmark');
    const boot_logo = document.getElementById('boot-logotype');
    if (wordmark && boot_logo) {
      const wr = wordmark.getBoundingClientRect();
      const br = boot_logo.getBoundingClientRect();
      // boot stage is centered at (window/2, window/2). Where do we need to translate to?
      if (wr.width > 0 && br.width > 0) {
        targetScale = Math.max(0.3, Math.min(0.8, wr.width / br.width));
      }
      // Translate stage center to wordmark center
      const wordmarkCenterX = wr.left + wr.width / 2;
      const wordmarkCenterY = wr.top + wr.height / 2;
      targetX = wordmarkCenterX - window.innerWidth / 2;
      targetY = wordmarkCenterY - window.innerHeight / 2;
    }

    track(stage.animate(
      [
        { transform: T.useDolly ? 'translateZ(80px) rotateY(0deg)' : 'translateZ(0) rotateY(0)', opacity: 1 },
        { transform: `translate(${targetX}px, ${targetY}px) scale(${targetScale}) translateZ(0)`, opacity: 0 },
      ],
      { duration: T.scatter, easing: 'cubic-bezier(.7, 0, .2, 1)', fill: 'forwards' }
    ));

    // Start fading the dark overlay background mid-scatter so the page emerges underneath
    const overlay = document.getElementById('boot');
    if (overlay) {
      setTimeout(() => {
        track(overlay.animate(
          [{ opacity: 1 }, { opacity: 0 }],
          { duration: T.scatter * 0.6, easing: 'ease', fill: 'forwards' }
        ));
      }, T.scatter * 0.45);
    }

    // Reveal the real page (visibility) just before the overlay finishes fading
    setTimeout(() => {
      document.body.classList.remove('boot-locked');
      document.body.classList.add('boot-finished');
      const tui = document.getElementById('docked-tui');
      if (tui) tui.style.opacity = '1';
    }, T.scatter * 0.55);

    await sleep(T.scatter);
  }

  // ────────────────────────────────────────────────────────────
  // PHASE 6 — SETTLE (just wait — the overlay already faded during scatter)
  // ────────────────────────────────────────────────────────────
  async function phaseSettle() {
    await sleep(T.settle);
  }

  // ────────────────────────────────────────────────────────────
  // Build helpers
  // ────────────────────────────────────────────────────────────
  function buildLetters(text, container) {
    container.innerHTML = '';
    const chars = text.split('');
    // Measure approximate per-char offset by inserting an offscreen probe.
    // Easier: estimate via emWidth based on font-size. We'll set 7 chars to
    // positions -3..+3 times an em-width approximation.
    const fontSize = parseFloat(getComputedStyle(container).fontSize) || 140;
    const emWidth = fontSize * 0.56; // ish for italic Fraunces
    const startX = -((chars.length - 1) / 2) * emWidth;

    return chars.map((ch, i) => {
      const span = document.createElement('span');
      span.className = 'boot__glyph';
      span.textContent = ch;
      span.style.position = 'absolute';
      span.style.left = '50%';
      span.style.top = '50%';
      span.style.transformOrigin = 'center';
      span.style.willChange = 'transform, opacity, filter';
      // random initial position in 3D space
      const init = {
        x: (Math.random() - 0.5) * 1200,
        y: (Math.random() - 0.5) * 800,
        z: -1600 - Math.random() * 600,
        rx: (Math.random() - 0.5) * 360,
        ry: (Math.random() - 0.5) * 360,
      };
      span._init = init;
      span._finalX = startX + i * emWidth;
      span.style.transform = `translate(${init.x}px, ${init.y}px) translateZ(${init.z}px) rotateX(${init.rx}deg) rotateY(${init.ry}deg)`;
      container.appendChild(span);
      return span;
    });
  }

  const FRAG_POOL = [
    '14:32 auth-rework',
    '~/.claude/projects',
    'bun test  ok',
    '2026-05-12',
    '11:08 ink-renderer',
    'feat/auth',
    '[Codex] 22:14',
    '355 msgs',
    '~/.codex/sessions',
    'rollout-7c1e.jsonl',
    'tool: Edit',
    '⏎ continue',
  ];

  function buildFragments(n, container) {
    container.innerHTML = '';
    const out = [];
    const used = new Set();
    for (let i = 0; i < n; i++) {
      let idx;
      do { idx = Math.floor(Math.random() * FRAG_POOL.length); } while (used.has(idx) && used.size < FRAG_POOL.length);
      used.add(idx);
      const span = document.createElement('span');
      span.className = 'boot__frag boot__frag--' + (i % 8 === 0 ? 'ember' : i % 3 === 0 ? 'moss' : 'ink');
      span.textContent = FRAG_POOL[idx];
      span.style.willChange = 'transform, opacity';
      const init = {
        x: (Math.random() - 0.5) * 1400,
        y: (Math.random() - 0.5) * 900,
        z: -1500 - Math.random() * 500,
        rx: (Math.random() - 0.5) * 90,
        ry: (Math.random() - 0.5) * 90,
      };
      span._init = init;
      span.style.transform = `translate(${init.x}px, ${init.y}px) translateZ(${init.z}px) rotateX(${init.rx}deg) rotateY(${init.ry}deg)`;
      container.appendChild(span);
      out.push(span);
    }
    return out;
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function finish(overlay) {
    if (finished) return;
    finished = true;

    // CRITICAL ORDER:
    // 1. Pin the overlay's opacity to 0 via inline style BEFORE cancelling any
    //    animations. WAAPI cancel() reverts the element to its pre-animation
    //    state — without this pin, the overlay would snap back to its CSS
    //    default (opacity 1) and cause a black flash before the .is-fading
    //    transition starts.
    overlay = overlay || document.getElementById('boot');
    if (overlay) {
      overlay.style.transition = 'none';
      overlay.style.opacity = '0';
      overlay.style.pointerEvents = 'none';
    }

    try { ctrl && ctrl.abort(); } catch {}
    cancelAll();
    try { sessionStorage.setItem('octx_booted_r3', '1'); } catch {}

    document.body.classList.remove('boot-locked');
    document.body.classList.add('boot-finished');
    const tui = document.getElementById('docked-tui');
    if (tui) tui.style.opacity = '1';

    if (overlay) {
      // Clear will-change to release GPU layers
      overlay.querySelectorAll('[style*="will-change"]').forEach(el => { el.style.willChange = ''; });
      setTimeout(() => overlay.remove(), 250);
    }

    if (typeof window.startSite === 'function') {
      try { window.startSite(); } catch (e) { console.error(e); }
    }
  }

  function instantFinish() {
    finished = true;
    const overlay = document.getElementById('boot');
    if (overlay) overlay.remove();
    document.body.classList.remove('boot-locked');
    document.body.classList.add('boot-finished');
    const tui = document.getElementById('docked-tui');
    if (tui) tui.style.opacity = '1';
    if (typeof window.startSite === 'function') {
      try { window.startSite(); } catch (e) { console.error(e); }
    }
  }
})();
