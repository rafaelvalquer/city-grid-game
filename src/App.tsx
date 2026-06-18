import { useCallback, useMemo, useEffect, useRef, useState } from 'react';
import { BarChart3, Hammer, X } from 'lucide-react';
import { GameWorld } from './game/engine/simulation';
import { PixiGame } from './game/rendering/PixiGame';
import { HudBar } from './components/HudBar';
import { ToolPanel } from './components/ToolPanel';
import { DetailsPanel } from './components/DetailsPanel';
import { BottomBar } from './components/BottomBar';
import { MainMenu } from './components/MainMenu';
import { AnalyticsPanel } from './components/AnalyticsPanel';
import { useGameStore } from './store/gameStore';
import type { GameSetupOptions } from './game/config/gameSetup';
import { DEFAULT_GAME_SETUP } from './game/config/gameSetup';

type AppScreen = 'menu' | 'sandbox';

export default function App() {
  const [screen, setScreen] = useState<AppScreen>('menu');
  const [setupOptions, setSetupOptions] = useState<GameSetupOptions>(DEFAULT_GAME_SETUP);
  const world = useMemo(() => (screen === 'sandbox' ? new GameWorld(setupOptions) : null), [screen, setupOptions]);
  const [mobilePanel, setMobilePanel] = useState<'tools' | 'details' | null>(null);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const wasPausedBeforeAnalytics = useRef(false);
  const paused = useGameStore((s) => s.paused);
  const setPaused = useGameStore((s) => s.setPaused);
  const setStats = useGameStore((s) => s.setStats);
  const setSelected = useGameStore((s) => s.setSelected);

  useEffect(() => {
    if (!world) return undefined;
    setStats(world.getSnapshot());
    setSelected(world.selected);
    return world.subscribe(() => {
      setStats(world.getSnapshot());
      setSelected(world.selected);
    });
  }, [world, setStats, setSelected]);

  const openAnalytics = useCallback(() => {
    if (analyticsOpen) return;
    wasPausedBeforeAnalytics.current = paused;
    setPaused(true);
    setAnalyticsOpen(true);
  }, [analyticsOpen, paused, setPaused]);

  const closeAnalytics = useCallback(() => {
    setAnalyticsOpen(false);
    setPaused(wasPausedBeforeAnalytics.current);
  }, [setPaused]);

  const toggleAnalytics = useCallback(() => {
    if (analyticsOpen) closeAnalytics();
    else openAnalytics();
  }, [analyticsOpen, closeAnalytics, openAnalytics]);

  if (screen === 'menu' || !world) {
    return <MainMenu onStartSandbox={(options) => {
      setSetupOptions(options);
      setScreen('sandbox');
    }} />;
  }

  return (
    <div className="app-shell">
      <HudBar analyticsOpen={analyticsOpen} onToggleAnalytics={toggleAnalytics} />
      <div className="main-layout">
        <ToolPanel className={mobilePanel === 'tools' ? 'is-open' : ''} onClose={() => setMobilePanel(null)} />
        <PixiGame world={world} graphics={setupOptions.graphics} />
        <DetailsPanel className={mobilePanel === 'details' ? 'is-open' : ''} world={world} onClose={() => setMobilePanel(null)} />
        {mobilePanel && <button className="drawer-scrim" aria-label="Fechar painel" onClick={() => setMobilePanel(null)} />}
        <nav className="mobile-dock" aria-label="Painéis">
          <button className={mobilePanel === 'tools' ? 'active' : ''} onClick={() => setMobilePanel((panel) => panel === 'tools' ? null : 'tools')}>
            {mobilePanel === 'tools' ? <X size={18} /> : <Hammer size={18} />}
            Controles
          </button>
          <button className={mobilePanel === 'details' ? 'active' : ''} onClick={() => setMobilePanel((panel) => panel === 'details' ? null : 'details')}>
            {mobilePanel === 'details' ? <X size={18} /> : <BarChart3 size={18} />}
            Detalhes
          </button>
        </nav>
      </div>
      {analyticsOpen && <AnalyticsPanel world={world} onClose={closeAnalytics} />}
      <BottomBar />
    </div>
  );
}
