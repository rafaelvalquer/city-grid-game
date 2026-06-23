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
import type { CampaignCityId, GameMode } from './game/config/gameSetup';
import { CampaignSelectionScreen } from './components/CampaignSelectionScreen';
import { CampaignVictoryModal } from './components/CampaignVictoryModal';
import { isCampaignLevel2Unlocked, isCampaignLevel3Unlocked, loadCampaignProgress, saveCampaignCompletion } from './game/campaign/campaignProgress';
import { getCampaignCity } from './game/campaign/campaignMaps';

type AppScreen = 'menu' | 'campaign-select' | 'game';

export default function App() {
  const [screen, setScreen] = useState<AppScreen>('menu');
  const [setupOptions, setSetupOptions] = useState<GameSetupOptions>(DEFAULT_GAME_SETUP);
  const [gameMode, setGameMode] = useState<GameMode>('sandbox');
  const [campaignCityId, setCampaignCityId] = useState<CampaignCityId | undefined>();
  const [campaignSelectionLevel, setCampaignSelectionLevel] = useState<1 | 2 | 3>(1);
  const [campaignLevelUnlockedByVictory, setCampaignLevelUnlockedByVictory] = useState<2 | 3 | null>(null);
  const world = useMemo(() => (screen === 'game'
    ? new GameWorld({ ...setupOptions, mode: gameMode, campaignCityId })
    : null), [screen, setupOptions, gameMode, campaignCityId]);
  const [mobilePanel, setMobilePanel] = useState<'tools' | 'details' | null>(null);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const wasPausedBeforeAnalytics = useRef(false);
  const paused = useGameStore((s) => s.paused);
  const setPaused = useGameStore((s) => s.setPaused);
  const setStats = useGameStore((s) => s.setStats);
  const setSelected = useGameStore((s) => s.setSelected);
  const campaignMission = useGameStore((s) => s.campaignMission);
  const setCampaignMission = useGameStore((s) => s.setCampaignMission);

  useEffect(() => {
    if (!world) return undefined;
    setStats(world.getSnapshot());
    setSelected(world.selected);
    setCampaignMission(world.getCampaignMissionSnapshot());
    return world.subscribe(() => {
      setStats(world.getSnapshot());
      setSelected(world.selected);
      setCampaignMission(world.getCampaignMissionSnapshot());
    });
  }, [world, setStats, setSelected, setCampaignMission]);

  useEffect(() => {
    if (!campaignMission?.completed) return;
    setPaused(true);
    try {
      const previousProgress = loadCampaignProgress();
      const wasLevel2Unlocked = isCampaignLevel2Unlocked(previousProgress);
      const wasLevel3Unlocked = isCampaignLevel3Unlocked(previousProgress);
      const progress = saveCampaignCompletion({
        cityId: campaignMission.cityId,
        completedAt: new Date().toISOString(),
        population: campaignMission.population,
        satisfaction: campaignMission.satisfaction,
        traffic: campaignMission.traffic,
        elapsedSeconds: campaignMission.elapsedSeconds,
        day: campaignMission.day,
        timeLabel: campaignMission.timeLabel,
      });
      if (!wasLevel3Unlocked && isCampaignLevel3Unlocked(progress)) setCampaignLevelUnlockedByVictory(3);
      else if (!wasLevel2Unlocked && isCampaignLevel2Unlocked(progress)) setCampaignLevelUnlockedByVictory(2);
    } catch {
      // Victory remains valid if storage is unavailable.
    }
  }, [campaignMission?.completed, campaignMission?.cityId, setPaused]);

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

  if (screen === 'menu') {
    return <MainMenu onOpenCampaign={(options) => {
      setSetupOptions(options);
      setScreen('campaign-select');
    }} onStartSandbox={(options) => {
      setSetupOptions(options);
      setGameMode('sandbox');
      setCampaignCityId(undefined);
      setCampaignMission(null);
      setPaused(false);
      setScreen('game');
    }} />;
  }
  if (screen === 'campaign-select') {
    return <CampaignSelectionScreen initialLevel={campaignSelectionLevel} onBack={() => setScreen('menu')} onSelect={(cityId) => {
      setCampaignCityId(cityId);
      setGameMode('campaign');
      setCampaignMission(null);
      setPaused(false);
      setScreen('game');
    }} />;
  }
  if (!world) return null;

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
      {campaignMission?.completed && <CampaignVictoryModal mission={campaignMission} unlockedLevel={campaignLevelUnlockedByVictory} onBack={() => {
        setCampaignSelectionLevel(campaignLevelUnlockedByVictory ?? getCampaignCity(campaignMission.cityId)?.campaignLevel ?? 1);
        setCampaignLevelUnlockedByVictory(null);
        setCampaignMission(null);
        setPaused(false);
        setScreen('campaign-select');
      }} />}
      <BottomBar />
    </div>
  );
}
