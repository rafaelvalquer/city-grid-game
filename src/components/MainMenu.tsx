import { useEffect, useState } from 'react';
import { ArrowLeft, CarFront, Clock3, Construction, Map, Play, Settings, Sparkles } from 'lucide-react';
import type { BuildingSpawnMode, GameSetupOptions } from '../game/config/gameSetup';
import { BUILDING_SPAWN_MODES, DEFAULT_GAME_SETUP, normalizeSpawnMode } from '../game/config/gameSetup';

const SPAWN_MODE_STORAGE_KEY = 'citySpawnMode';
const ROAD_DEMOLITION_STORAGE_KEY = 'cityAllowRoadDemolition';
const TERRAIN_RELIEF_STORAGE_KEY = 'cityEnableTerrainRelief';

export function MainMenu({ onStartSandbox }: { onStartSandbox: (options: GameSetupOptions) => void }) {
  const [view, setView] = useState<'home' | 'settings'>('home');
  const [spawnMode, setSpawnMode] = useState<BuildingSpawnMode>(DEFAULT_GAME_SETUP.spawnMode);
  const [allowRoadDemolition, setAllowRoadDemolition] = useState(DEFAULT_GAME_SETUP.allowRoadDemolition);
  const [enableTerrainRelief, setEnableTerrainRelief] = useState(DEFAULT_GAME_SETUP.enableTerrainRelief);

  useEffect(() => {
    try {
      setSpawnMode(normalizeSpawnMode(localStorage.getItem(SPAWN_MODE_STORAGE_KEY)));
      setAllowRoadDemolition(localStorage.getItem(ROAD_DEMOLITION_STORAGE_KEY) === '1');
      const storedTerrainRelief = localStorage.getItem(TERRAIN_RELIEF_STORAGE_KEY);
      setEnableTerrainRelief(storedTerrainRelief === null ? DEFAULT_GAME_SETUP.enableTerrainRelief : storedTerrainRelief === '1');
    } catch {
      setSpawnMode(DEFAULT_GAME_SETUP.spawnMode);
      setAllowRoadDemolition(DEFAULT_GAME_SETUP.allowRoadDemolition);
      setEnableTerrainRelief(DEFAULT_GAME_SETUP.enableTerrainRelief);
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

  const toggleRoadDemolition = () => {
    setAllowRoadDemolition((current) => {
      const next = !current;
      try {
        localStorage.setItem(ROAD_DEMOLITION_STORAGE_KEY, next ? '1' : '0');
      } catch {
        // Keep working with local state when storage is unavailable.
      }
      return next;
    });
  };

  const toggleTerrainRelief = () => {
    setEnableTerrainRelief((current) => {
      const next = !current;
      try {
        localStorage.setItem(TERRAIN_RELIEF_STORAGE_KEY, next ? '1' : '0');
      } catch {
        // Keep working with local state when storage is unavailable.
      }
      return next;
    });
  };

  const startSandbox = () => onStartSandbox({ spawnMode, allowRoadDemolition, enableTerrainRelief });
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
            <div className="menu-selected-setting">
              <span>Demolição para vias</span>
              <strong>{allowRoadDemolition ? 'Habilitada' : 'Desabilitada'}</strong>
            </div>
            <div className="menu-selected-setting">
              <span>Relevos naturais</span>
              <strong>{enableTerrainRelief ? 'Habilitados' : 'Desabilitados'}</strong>
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

            <button
              className={`demolition-setting-card ${allowRoadDemolition ? 'selected' : ''}`}
              onClick={toggleRoadDemolition}
              aria-pressed={allowRoadDemolition}
            >
              <RoadDemolitionPreview />
              <span>
                <strong><Construction size={15} /> Permitir demolição para vias</strong>
                <small>Rua ou avenida pode substituir casas, comércios e escritórios cobrando a obra mais uma penalidade por nível.</small>
              </span>
              <i className="setting-toggle" aria-hidden="true" />
            </button>

            <button
              className={`demolition-setting-card terrain-setting-card ${enableTerrainRelief ? 'selected' : ''}`}
              onClick={toggleTerrainRelief}
              aria-pressed={enableTerrainRelief}
            >
              <TerrainReliefPreview />
              <span>
                <strong>Relevos naturais</strong>
                <small>Gera montanhas e lagos orgânicos que bloqueiam construções e obrigam a cidade a contornar o terreno.</small>
              </span>
              <i className="setting-toggle" aria-hidden="true" />
            </button>

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

function RoadDemolitionPreview() {
  return (
    <i className="demolition-preview" aria-hidden="true">
      <b className="demolition-building" />
      <b className="demolition-road" />
      <b className="demolition-crack one" />
      <b className="demolition-crack two" />
      <b className="demolition-cost">-$</b>
    </i>
  );
}


function TerrainReliefPreview() {
  return (
    <i className="terrain-relief-preview" aria-hidden="true">
      <b className="terrain-mountain one" />
      <b className="terrain-mountain two" />
      <b className="terrain-lake" />
      <b className="terrain-wave one" />
      <b className="terrain-wave two" />
    </i>
  );
}
