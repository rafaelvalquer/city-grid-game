import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ArrowLeft, CarFront, Clock3, Construction, Gauge, Map, MonitorCog, Play, Settings, Sparkles,
} from 'lucide-react';
import type { BuildingSpawnMode, GameSetupOptions } from '../game/config/gameSetup';
import {
  BUILDING_SPAWN_MODES, DEFAULT_GAME_SETUP, loadGameSetupOptions, saveGameSetupOptions,
} from '../game/config/gameSetup';
import {
  applyGraphicsPreset, updateGraphicsSetting, type GraphicsProfile, type GraphicsSettings,
} from '../game/config/graphicsSettings';

export function MainMenu({ onStartSandbox }: { onStartSandbox: (options: GameSetupOptions) => void }) {
  const [view, setView] = useState<'home' | 'settings'>('home');
  const [settingsTab, setSettingsTab] = useState<'game' | 'graphics'>('game');
  const [options, setOptions] = useState<GameSetupOptions>({
    ...DEFAULT_GAME_SETUP,
    graphics: { ...DEFAULT_GAME_SETUP.graphics },
  });

  useEffect(() => setOptions(loadGameSetupOptions()), []);

  const updateOptions = (next: GameSetupOptions) => {
    setOptions(next);
    try {
      saveGameSetupOptions(next);
    } catch {
      // Local state remains usable when storage is unavailable.
    }
  };

  const patchOptions = (patch: Partial<GameSetupOptions>) => updateOptions({ ...options, ...patch });
  const selectedMode = BUILDING_SPAWN_MODES.find((mode) => mode.id === options.spawnMode) ?? BUILDING_SPAWN_MODES[0];
  const profileLabel = graphicsProfileLabel(options.graphics.profile);

  return (
    <main className="main-menu-screen">
      <MenuBackground />
      <section className={`main-menu-card ${view === 'settings' ? 'settings-view' : ''}`} aria-labelledby="main-menu-title">
        <div className="menu-brand-mark">CF</div>
        <p className="menu-kicker"><Sparkles size={15} /> Cidade viva em tempo real</p>

        {view === 'home' ? (
          <>
            <h1 id="main-menu-title">Cidade em Fluxo</h1>
            <p className="menu-copy">Construa uma cidade e observe o trânsito urbano ganhar vida em tempo real.</p>
            <button className="menu-primary-action" onClick={() => onStartSandbox(options)}>
              <Play size={18} /> Jogar Sandbox
            </button>
            <button className="menu-secondary-action" onClick={() => setView('settings')}>
              <Settings size={17} /> Configurações
            </button>
            <SettingSummary label="Surgimento" value={selectedMode.label} />
            <SettingSummary label="Demolição para vias" value={options.allowRoadDemolition ? 'Habilitada' : 'Desabilitada'} />
            <SettingSummary label="Relevos naturais" value={options.enableTerrainRelief ? 'Habilitados' : 'Desabilitados'} />
            <SettingSummary label="Gráficos" value={`${profileLabel} · Debug ${options.graphics.showPerformanceDebug ? 'ligado' : 'desligado'}`} />
            <div className="menu-mode-grid">
              <MenuMode icon={<Map size={16} />} title="Sandbox" subtitle="Modo infinito" active />
              <MenuMode icon={<Clock3 size={16} />} title="Campanha" subtitle="Em breve" />
              <MenuMode icon={<CarFront size={16} />} title="Cenários" subtitle="Em breve" />
            </div>
          </>
        ) : (
          <>
            <h1 id="main-menu-title">Configurações</h1>
            <p className="menu-copy">Ajuste o sandbox e a qualidade visual antes de criar a cidade.</p>
            <div className="settings-tabs" role="tablist" aria-label="Categorias de configurações">
              <button className={settingsTab === 'game' ? 'active' : ''} onClick={() => setSettingsTab('game')} role="tab" aria-selected={settingsTab === 'game'}>
                <Settings size={16} /> Jogo
              </button>
              <button className={settingsTab === 'graphics' ? 'active' : ''} onClick={() => setSettingsTab('graphics')} role="tab" aria-selected={settingsTab === 'graphics'}>
                <MonitorCog size={16} /> Gráficos
              </button>
            </div>

            {settingsTab === 'game' ? (
              <GameSettingsPanel options={options} onChange={updateOptions} />
            ) : (
              <GraphicsSettingsPanel settings={options.graphics} onChange={(graphics) => patchOptions({ graphics })} />
            )}

            <div className="menu-settings-actions">
              <button className="menu-secondary-action" onClick={() => setView('home')}>
                <ArrowLeft size={17} /> Voltar
              </button>
              <button className="menu-primary-action compact" onClick={() => onStartSandbox(options)}>
                <Play size={18} /> Jogar Sandbox
              </button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}

function GameSettingsPanel({ options, onChange }: { options: GameSetupOptions; onChange: (next: GameSetupOptions) => void }) {
  return (
    <div className="settings-tab-panel" role="tabpanel">
      <div className="spawn-mode-list" role="radiogroup" aria-label="Modo de surgimento das construções">
        {BUILDING_SPAWN_MODES.map((mode) => (
          <button
            key={mode.id}
            className={`spawn-mode-card ${options.spawnMode === mode.id ? 'selected' : ''}`}
            onClick={() => onChange({ ...options, spawnMode: mode.id })}
            role="radio"
            aria-checked={options.spawnMode === mode.id}
          >
            <SpawnModePreview mode={mode.id} />
            <span><strong>{mode.label}</strong><small>{mode.description}</small></span>
          </button>
        ))}
      </div>
      <GameSwitch
        selected={options.allowRoadDemolition}
        onClick={() => onChange({ ...options, allowRoadDemolition: !options.allowRoadDemolition })}
        preview={<RoadDemolitionPreview />}
        title={<><Construction size={15} /> Permitir demolição para vias</>}
        description="Ruas e avenidas podem substituir construções, cobrando a obra e uma penalidade por nível."
      />
      <GameSwitch
        selected={options.enableTerrainRelief}
        onClick={() => onChange({ ...options, enableTerrainRelief: !options.enableTerrainRelief })}
        preview={<TerrainReliefPreview />}
        title="Relevos naturais"
        description="Gera montanhas e lagos que bloqueiam construções e mudam o desenho da cidade."
      />
    </div>
  );
}

function GraphicsSettingsPanel({ settings, onChange }: { settings: GraphicsSettings; onChange: (next: GraphicsSettings) => void }) {
  const set = <K extends keyof GraphicsSettings,>(key: K, value: GraphicsSettings[K]) => (
    onChange(updateGraphicsSetting(settings, key, value))
  );
  const indicator = settings.profile === 'low' ? 'Mais desempenho' : settings.profile === 'high' ? 'Mais qualidade' : 'Equilibrado';

  return (
    <div className="graphics-settings-panel settings-tab-panel" role="tabpanel">
      <section className="graphics-profile-section">
        <div className="graphics-section-heading">
          <span><Gauge size={16} /><strong>Perfil gráfico</strong></span>
          <em className={`quality-indicator ${settings.profile}`}>{indicator}</em>
        </div>
        <div className="graphics-profile-grid" role="radiogroup" aria-label="Perfil gráfico">
          {(['low', 'medium', 'high'] as const).map((profile) => (
            <button
              key={profile}
              className={settings.profile === profile ? 'selected' : ''}
              onClick={() => onChange(applyGraphicsPreset(profile, settings))}
              role="radio"
              aria-checked={settings.profile === profile}
            >
              <strong>{graphicsProfileLabel(profile)}</strong>
              <small>{profile === 'low' ? 'Prioriza FPS' : profile === 'medium' ? 'Visual equilibrado' : 'Todos os detalhes'}</small>
            </button>
          ))}
          <button className={settings.profile === 'custom' ? 'selected' : ''} disabled={settings.profile !== 'custom'}>
            <strong>Personalizado</strong><small>Ajustes individuais</small>
          </button>
        </div>
      </section>

      <GraphicsSection title="Qualidade">
        <ChoiceRow label="Resolução interna" value={`${settings.resolutionScale * 100}%`}>
          {[0.75, 1, 1.25].map((value) => (
            <ChoiceButton key={value} active={settings.resolutionScale === value} onClick={() => set('resolutionScale', value as GraphicsSettings['resolutionScale'])}>
              {value * 100}%
            </ChoiceButton>
          ))}
        </ChoiceRow>
        <GraphicsSwitch label="Antialias" description="Suaviza bordas; aumenta o custo da GPU." checked={settings.antialias} onChange={(value) => set('antialias', value)} />
        <ChoiceRow label="Detalhe dos veículos" value={vehicleDetailLabel(settings.vehicleDetail)}>
          {(['simplified', 'auto', 'full'] as const).map((value) => (
            <ChoiceButton key={value} active={settings.vehicleDetail === value} onClick={() => set('vehicleDetail', value)}>
              {vehicleDetailLabel(value)}
            </ChoiceButton>
          ))}
        </ChoiceRow>
        <ChoiceRow label="FPS do ambiente" value={`${settings.environmentFps}`}>
          {([15, 30, 60] as const).map((value) => (
            <ChoiceButton key={value} active={settings.environmentFps === value} onClick={() => set('environmentFps', value)}>{value}</ChoiceButton>
          ))}
        </ChoiceRow>
      </GraphicsSection>

      <GraphicsSection title="Iluminação e ambiente">
        <GraphicsSwitch label="Faróis e lanternas" description="Luzes e fachos dos veículos." checked={settings.vehicleLights} onChange={(value) => set('vehicleLights', value)} />
        <GraphicsSwitch label="Luzes dos prédios" description="Janelas, fachadas e brilho noturno." checked={settings.buildingLights} onChange={(value) => set('buildingLights', value)} />
        <GraphicsSwitch label="Iluminação pública" description="Postes e halos nas vias." checked={settings.streetLights} onChange={(value) => set('streetLights', value)} />
        <GraphicsSwitch label="Overlay de manhã/noite" description="Coloração atmosférica por período." checked={settings.atmosphereOverlay} onChange={(value) => set('atmosphereOverlay', value)} />
        <GraphicsSwitch label="Pedestres e vida urbana" description="Pessoas e movimento junto aos prédios." checked={settings.pedestrians} onChange={(value) => set('pedestrians', value)} />
        <GraphicsSwitch label="Mobiliário e detalhes de lotes" description="Bancos, árvores e pequenos objetos." checked={settings.streetFurniture} onChange={(value) => set('streetFurniture', value)} />
        <GraphicsSwitch label="Lagos e montanhas animados" description="Ondas, névoa e microanimações." checked={settings.terrainAnimations} onChange={(value) => set('terrainAnimations', value)} />
      </GraphicsSection>

      <GraphicsSection title="Efeitos">
        <GraphicsSwitch label="Sombras dos veículos" description="Profundidade visual sob carros e ônibus." checked={settings.vehicleShadows} onChange={(value) => set('vehicleShadows', value)} />
        <GraphicsSwitch label="Partículas de construção" description="Poeira, faíscas e pulsos de conexão." checked={settings.constructionParticles} onChange={(value) => set('constructionParticles', value)} />
        <GraphicsSwitch label="Fumaça de congestionamento" description="Fumaça emitida em trechos congestionados." checked={settings.congestionSmoke} onChange={(value) => set('congestionSmoke', value)} />
      </GraphicsSection>

      <GraphicsSection title="Diagnóstico">
        <GraphicsSwitch label="Painel de performance/debug" description="Exibe FPS, frame P95 e tempos das camadas." checked={settings.showPerformanceDebug} onChange={(value) => set('showPerformanceDebug', value)} />
      </GraphicsSection>
    </div>
  );
}

function GraphicsSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="graphics-section"><h2>{title}</h2><div>{children}</div></section>;
}

function GraphicsSwitch({ label, description, checked, onChange }: {
  label: string; description: string; checked: boolean; onChange: (value: boolean) => void;
}) {
  return (
    <button className={`graphics-switch ${checked ? 'selected' : ''}`} onClick={() => onChange(!checked)} aria-pressed={checked}>
      <span><strong>{label}</strong><small>{description}</small></span>
      <i className="setting-toggle" aria-hidden="true" />
    </button>
  );
}

function ChoiceRow({ label, value, children }: { label: string; value: string; children: ReactNode }) {
  return <div className="graphics-choice-row"><span><strong>{label}</strong><small>{value}</small></span><div>{children}</div></div>;
}

function ChoiceButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return <button className={active ? 'selected' : ''} onClick={onClick}>{children}</button>;
}

function GameSwitch({ selected, onClick, preview, title, description }: {
  selected: boolean; onClick: () => void; preview: ReactNode; title: ReactNode; description: string;
}) {
  return (
    <button className={`demolition-setting-card ${selected ? 'selected' : ''}`} onClick={onClick} aria-pressed={selected}>
      {preview}<span><strong>{title}</strong><small>{description}</small></span><i className="setting-toggle" aria-hidden="true" />
    </button>
  );
}

function SettingSummary({ label, value }: { label: string; value: string }) {
  return <div className="menu-selected-setting"><span>{label}</span><strong>{value}</strong></div>;
}

function MenuMode({ icon, title, subtitle, active = false }: {
  icon: ReactNode; title: string; subtitle: string; active?: boolean;
}) {
  return <div className={`menu-mode ${active ? 'active' : 'disabled'}`} aria-disabled={!active}>{icon}<div><strong>{title}</strong><span>{subtitle}</span></div></div>;
}

function MenuBackground() {
  return (
    <div className="menu-city-bg" aria-hidden="true">
      <div className="menu-road menu-road-horizontal one" /><div className="menu-road menu-road-horizontal two" />
      <div className="menu-road menu-road-vertical one" /><div className="menu-road menu-road-vertical two" />
      <div className="menu-building house a" /><div className="menu-building shop b" />
      <div className="menu-building office c" /><div className="menu-building house d" /><div className="menu-building shop e" />
      <div className="menu-car car-a" /><div className="menu-car car-b" /><div className="menu-car car-c" /><div className="menu-car car-d" />
    </div>
  );
}

function SpawnModePreview({ mode }: { mode: BuildingSpawnMode }) {
  return <i className={`spawn-preview ${mode}`} aria-hidden="true">{Array.from({ length: 9 }).map((_, index) => <b key={index} />)}</i>;
}

function RoadDemolitionPreview() {
  return (
    <i className="demolition-preview" aria-hidden="true">
      <b className="demolition-building" /><b className="demolition-road" />
      <b className="demolition-crack one" /><b className="demolition-crack two" /><b className="demolition-cost">-$</b>
    </i>
  );
}

function TerrainReliefPreview() {
  return (
    <i className="terrain-relief-preview" aria-hidden="true">
      <b className="terrain-mountain one" /><b className="terrain-mountain two" />
      <b className="terrain-lake" /><b className="terrain-wave one" /><b className="terrain-wave two" />
    </i>
  );
}

function graphicsProfileLabel(profile: GraphicsProfile): string {
  return ({ low: 'Baixo', medium: 'Médio', high: 'Alto', custom: 'Personalizado' } as const)[profile];
}

function vehicleDetailLabel(detail: GraphicsSettings['vehicleDetail']): string {
  return ({ simplified: 'Simplificado', auto: 'Automático', full: 'Completo' } as const)[detail];
}
