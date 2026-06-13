import { useEffect, useState } from 'react';
import { ArrowLeft, CarFront, Clock3, Map, Play, Settings, Sparkles } from 'lucide-react';
import type { BuildingSpawnMode, GameSetupOptions } from '../game/config/gameSetup';
import { BUILDING_SPAWN_MODES, DEFAULT_GAME_SETUP, normalizeSpawnMode } from '../game/config/gameSetup';

const SPAWN_MODE_STORAGE_KEY = 'citySpawnMode';

export function MainMenu({ onStartSandbox }: { onStartSandbox: (options: GameSetupOptions) => void }) {
  const [view, setView] = useState<'home' | 'settings'>('home');
  const [spawnMode, setSpawnMode] = useState<BuildingSpawnMode>(DEFAULT_GAME_SETUP.spawnMode);

  useEffect(() => {
    try {
      setSpawnMode(normalizeSpawnMode(localStorage.getItem(SPAWN_MODE_STORAGE_KEY)));
    } catch {
      setSpawnMode(DEFAULT_GAME_SETUP.spawnMode);
    }
  }, []);

  const selectSpawnMode = (mode: BuildingSpawnMode) => {
    setSpawnMode(mode);
    try {
      localStorage.setItem(SPAWN_MODE_STORAGE_KEY, mode);
    } catch {
      // Keep working with local state when storage is unavailable.
    }
  };

  const startSandbox = () => onStartSandbox({ spawnMode });
  const selectedMode = BUILDING_SPAWN_MODES.find((mode) => mode.id === spawnMode) ?? BUILDING_SPAWN_MODES[0];

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

      <section className={`main-menu-card ${view === 'settings' ? 'settings-view' : ''}`} aria-labelledby="main-menu-title">
        <div className="menu-brand-mark">CF</div>
        <p className="menu-kicker"><Sparkles size={15} /> Cidade viva em tempo real</p>

        {view === 'home' ? (
          <>
            <h1 id="main-menu-title">Cidade em Fluxo</h1>
            <p className="menu-copy">
              Construa ruas, avenidas, rotatórias e semáforos em um sandbox infinito de tráfego urbano.
            </p>

            <button className="menu-primary-action" onClick={startSandbox}>
              <Play size={18} />
              Jogar Sandbox
            </button>

            <button className="menu-secondary-action" onClick={() => setView('settings')}>
              <Settings size={17} />
              Configurações
            </button>

            <div className="menu-selected-setting">
              <span>Surgimento</span>
              <strong>{selectedMode.label}</strong>
            </div>

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
          </>
        ) : (
          <>
            <h1 id="main-menu-title">Configurações</h1>
            <p className="menu-copy">
              Escolha como os prédios surgem. Isso muda a organização inicial e o crescimento da cidade.
            </p>

            <div className="spawn-mode-list" role="radiogroup" aria-label="Modo de surgimento das construções">
              {BUILDING_SPAWN_MODES.map((mode) => (
                <button
                  key={mode.id}
                  className={`spawn-mode-card ${spawnMode === mode.id ? 'selected' : ''}`}
                  onClick={() => selectSpawnMode(mode.id)}
                  role="radio"
                  aria-checked={spawnMode === mode.id}
                >
                  <SpawnModePreview mode={mode.id} />
                  <span>
                    <strong>{mode.label}</strong>
                    <small>{mode.description}</small>
                  </span>
                </button>
              ))}
            </div>

            <div className="menu-settings-actions">
              <button className="menu-secondary-action" onClick={() => setView('home')}>
                <ArrowLeft size={17} />
                Voltar
              </button>
              <button className="menu-primary-action compact" onClick={startSandbox}>
                <Play size={18} />
                Jogar Sandbox
              </button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}

function SpawnModePreview({ mode }: { mode: BuildingSpawnMode }) {
  return (
    <i className={`spawn-preview ${mode}`} aria-hidden="true">
      {Array.from({ length: 9 }).map((_, index) => <b key={index} />)}
    </i>
  );
}
