import { CircleDot, Eye, Hammer, Pause, Play, Radar, Route, Trash2, X } from 'lucide-react';
import { useGameStore, type HeatmapMode } from '../store/gameStore';
import type { SimulationSpeed } from '../types/game.types';

const heatmapModes: Array<{ id: HeatmapMode; label: string }> = [
  { id: 'traffic', label: 'Trânsito' },
  { id: 'satisfaction', label: 'Satisfação' },
  { id: 'flow', label: 'Fluxo' },
  { id: 'off', label: 'Off' },
];

export function ToolPanel({ className = '', onClose }: { className?: string; onClose?: () => void }) {
  const heatmapMode = useGameStore((s) => s.heatmapMode);
  const setHeatmapMode = useGameStore((s) => s.setHeatmapMode);
  const paused = useGameStore((s) => s.paused);
  const togglePaused = useGameStore((s) => s.togglePaused);
  const speed = useGameStore((s) => s.speed);
  const setSpeed = useGameStore((s) => s.setSpeed);

  return (
    <aside className={`tool-panel ${className}`}>
      <div className="panel-heading">
        <span className="heading-icon"><Hammer size={16} /></span>
        <h2>Controles</h2>
        <button className="panel-close" aria-label="Fechar controles" onClick={onClose}><X size={17} /></button>
      </div>

      <div className="panel-section">
        <h3>Visualização</h3>
        <div className="heatmap-mode-grid" role="group" aria-label="Modo de heatmap">
          {heatmapModes.map((mode) => (
            <button
              key={mode.id}
              className={heatmapMode === mode.id ? 'heatmap-mode active' : 'heatmap-mode'}
              onClick={() => setHeatmapMode(mode.id)}
            >
              {mode.label}
            </button>
          ))}
        </div>
        <div className="hint"><Radar size={14} /> Camadas para diagnosticar a cidade.</div>
      </div>

      <div className="panel-section">
        <h3>Simulação</h3>
        <button className="tool" onClick={togglePaused}>{paused ? <Play size={16} /> : <Pause size={16} />} {paused ? 'Continuar' : 'Pausar'}</button>
        <div className="speed-row">
          {[1, 2, 4].map((value) => (
            <button key={value} className={speed === value ? 'speed active' : 'speed'} onClick={() => setSpeed(value as SimulationSpeed)}>{value}x</button>
          ))}
        </div>
      </div>

      <div className="panel-section small">
        <div><Route size={14} /> Carros escolhem menor tempo.</div>
        <div><CircleDot size={14} /> Semáforo funciona apenas em cruzamentos.</div>
        <div><Eye size={14} /> Clique para ver detalhes.</div>
        <div><Trash2 size={14} /> Remover rua também remove semáforo.</div>
      </div>
    </aside>
  );
}
