// Demand-driven motion for the single explicitly opened viewer.
export function createTurntable({ window, document, host, controls, render, onChange, rotation = null }) {
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  let active = false;
  let disposed = false;
  let visible = !window.IntersectionObserver;
  let frame = 0;
  let lastTime = 0;
  const canRender = () => !disposed && visible && !document.hidden;
  function cancel() { window.cancelAnimationFrame(frame); frame = 0; }
  function tick(time) {
    frame = 0;
    if (!active || !canRender()) return;
    const delta = (time - lastTime) / 1000;
    if (delta >= 1 / 30) {
      controls.update(Math.min(delta, .05));
      lastTime = time;
      // OrbitControls emits change for its actual camera update; that owns the paint.
    }
    if (active && canRender()) frame = window.requestAnimationFrame(tick);
  }
  function sync() {
    cancel();
    if (!canRender()) return;
    render();
    if (active && canRender()) {
      lastTime = window.performance.now();
      frame = window.requestAnimationFrame(tick);
    }
  }
  function set(value) {
    if (disposed) return false;
    active = value;
    controls.autoRotate = value;
    controls.autoRotateSpeed = .2; // One revolution in five minutes, in real 3D.
    onChange(value);
    sync();
    return active;
  }
  const pause = () => set(false);
  const changedPreference = () => { if (preference.matches) pause(); };
  const observer = window.IntersectionObserver ? new window.IntersectionObserver(entries => {
    visible = entries[0]?.isIntersecting ?? false;
    sync();
  }) : undefined;
  observer?.observe(host);
  controls.addEventListener('start', pause);
  document.addEventListener('visibilitychange', sync);
  preference.addEventListener('change', changedPreference);
  return {
    canRender,
    start() { return set(rotation ?? !preference.matches); },
    pause,
    toggle() { return set(!active); },
    dispose() {
      disposed = true;
      controls.autoRotate = false;
      cancel();
      observer?.disconnect();
      controls.removeEventListener('start', pause);
      document.removeEventListener('visibilitychange', sync);
      preference.removeEventListener('change', changedPreference);
    },
  };
}
