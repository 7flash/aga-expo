export default function HomePage() {
  return (
    <main class="page-shell">
      <div class="ambient ambient-one" aria-hidden="true" />
      <div class="ambient ambient-two" aria-hidden="true" />
      <div class="ambient ambient-three" aria-hidden="true" />

      <section class="experience-shell" aria-label="AGA voice assistant experience">
        <div class="brand-pill">
          <span class="brand-mark">A</span>
          <div class="brand-copy">
            <strong>AGA</strong>
            <span>Always-listening voice companion</span>
          </div>
        </div>

        <div class="top-status-pill" aria-hidden="true">
          <span class="status-dot" />
          <span>Wake word: “AGA” · YouTube · music · live translate</span>
        </div>

        <div id="three-stage" class="three-stage">
          <div class="stage-fallback">
            <p>Waking AGA…</p>
          </div>
        </div>

        <div id="assistant-root" class="assistant-overlay" />
      </section>
    </main>
  );
}
