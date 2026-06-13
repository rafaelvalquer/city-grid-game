import { CarFront, Clock3, Map, Play, Sparkles } from 'lucide-react';

export function MainMenu({ onStartSandbox }: { onStartSandbox: () => void }) {
  return (
    <main className="main-menu-screen">
      <div className="menu-city-bg" aria-hidden="true">
        <div className="menu-road menu-road-horizontal one" />
        <div className="menu-road menu-road-horizontal two" />
        <div className="menu-road menu-road-vertical one" />
        <div className="menu-road menu-road-vertical two" />
        <div className="menu-building house a" />
        <div className="menu-building shop b" />
        <div className="menu-building office c" />
        <div className="menu-building house d" />
        <div className="menu-building shop e" />
        <div className="menu-car car-a" />
        <div className="menu-car car-b" />
        <div className="menu-car car-c" />
        <div className="menu-car car-d" />
      </div>

      <section className="main-menu-card" aria-labelledby="main-menu-title">
        <div className="menu-brand-mark">CF</div>
        <p className="menu-kicker"><Sparkles size={15} /> Cidade viva em tempo real</p>
        <h1 id="main-menu-title">Cidade em Fluxo</h1>
        <p className="menu-copy">
          Construa ruas, avenidas, rotatórias e semáforos em um sandbox infinito de tráfego urbano.
        </p>

        <button className="menu-primary-action" onClick={onStartSandbox}>
          <Play size={18} />
          Jogar Sandbox
        </button>

        <div className="menu-mode-grid">
          <div className="menu-mode active">
            <Map size={16} />
            <div>
              <strong>Sandbox</strong>
              <span>Modo infinito</span>
            </div>
          </div>
          <div className="menu-mode disabled" aria-disabled="true">
            <Clock3 size={16} />
            <div>
              <strong>Campanha</strong>
              <span>Em breve</span>
            </div>
          </div>
          <div className="menu-mode disabled" aria-disabled="true">
            <CarFront size={16} />
            <div>
              <strong>Cenários</strong>
              <span>Em breve</span>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
