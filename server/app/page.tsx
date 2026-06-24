export default function HomePage() {
  return (
    <main class="page-shell">
      <div class="ambient ambient-one" aria-hidden="true" />
      <div class="ambient ambient-two" aria-hidden="true" />
      <div class="ambient ambient-three" aria-hidden="true" />

      <section class="experience-shell" aria-label="Geeksy voice assistant experience">
        <div class="brand-pill">
          <span class="brand-mark">G</span>
          <div class="brand-copy">
            <strong>Geeksy</strong>
            <span>Voice-first cute glass robot</span>
          </div>
        </div>

        <div class="top-status-pill" aria-hidden="true">
          <span class="status-dot" />
          <span>Three.js robot · voice only input</span>
        </div>

        <div id="three-stage" class="three-stage">
          <div class="stage-fallback">
            <p>Loading Geeksy…</p>
          </div>
        </div>

        <div id="assistant-root" class="assistant-overlay" />
      </section>
    </main>
  );
}
