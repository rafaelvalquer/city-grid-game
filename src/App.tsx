import { useMemo, useEffect, useState } from 'react';
import { BarChart3, Hammer, X } from 'lucide-react';
import { GameWorld } from './game/engine/simulation';
import { PixiGame } from './game/rendering/PixiGame';
import { HudBar } from './components/HudBar';
import { ToolPanel } from './components/ToolPanel';
import { DetailsPanel } from './components/DetailsPanel';
import { BottomBar } from './components/BottomBar';
import { MainMenu } from './components/MainMenu';
import { useGameStore } from './store/gameStore';

type AppScreen = 'menu' | 'sandbox';

export default function App() {
  const [screen, setScreen] = useState<AppScreen>('menu');
  const world = useMemo(() => (screen === 'sandbox' ? new GameWorld() : null), [screen]);
  const [mobilePanel, setMobilePanel] = useState<'tools' | 'details' | null>(null);
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

  if (screen === 'menu' || !world) {
    return <MainMenu onStartSandbox={() => setScreen('sandbox')} />;
  }

  return (
    <div className="app-shell">
      <HudBar />
      <div className="main-layout">
        <ToolPanel className={mobilePanel === 'tools' ? 'is-open' : ''} onClose={() => setMobilePanel(null)} />
        <PixiGame world={world} />
        <DetailsPanel className={mobilePanel === 'details' ? 'is-open' : ''} world={world} onClose={() => setMobilePanel(null)} />
        {mobilePanel && <button className="drawer-scrim" aria-label="Fechar painel" onClick={() => setMobilePanel(null)} />}
        <nav className="mobile-dock" aria-label="Painéis">
          <button className={mobilePanel === 'tools' ? 'active' : ''} onClick={() => setMobilePanel((panel) => panel === 'tools' ? null : 'tools')}>
            {mobilePanel === 'tools' ? <X size={18} /> : <Hammer size={18} />}
            Ferramentas
          </button>
          <button className={mobilePanel === 'details' ? 'active' : ''} onClick={() => setMobilePanel((panel) => panel === 'details' ? null : 'details')}>
            {mobilePanel === 'details' ? <X size={18} /> : <BarChart3 size={18} />}
            Detalhes
          </button>
        </nav>
      </div>
      <BottomBar />
    </div>
  );
}
