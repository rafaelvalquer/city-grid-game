import { CircleDot, Eye, Gauge, Hammer, Pause, Play, Radar, Route, Trash2, X } from 'lucide-react';
import { useGameStore, type HeatmapMode } from '../store/gameStore';
import type { Tool, SimulationSpeed } from '../types/game.types';
import { ROAD_CONFIG } from '../game/config/roadConfig';
import { TRAFFIC_LIGHT_BUILD_COST } from '../game/systems/trafficLights';

const tools: Array<{ id: Tool; label: string; cost?: number; Icon: typeof Route }> = [
  { id: 'road', label: 'Rua', cost: ROAD_CONFIG.road.buildCost, Icon: Route },
  { id: 'avenue', label: 'Avenida', cost: ROAD_CONFIG.avenue.buildCost, Icon: Gauge },
  { id: 'trafficLight', label: 'Semáforo', cost: TRAFFIC_LIGHT_BUILD_COST, Icon: CircleDot },
  { id: 'remove', label: 'Remover', cost: ROAD_CONFIG.road.removeCost, Icon: Trash2 },
  { id: 'inspect', label: 'Inspecionar', Icon: Eye },
];

const heatmapModes: Array<{ id: HeatmapMode; label: string }> = [
  { id: 'traffic', label: 'Trânsito' },
  { id: 'satisfaction', label: 'Satisfação' },
  { id: 'flow', label: 'Fluxo' },
  { id: 'disconnected', label: 'Conexões' },
  { id: 'off', label: 'Off' },
];

export function ToolPanel({ className = '', onClose }: { className?: string; onClose?: () => void }) {
  const selectedTool = useGameStore((s) => s.selectedTool);
  const setTool = useGameStore((s) => s.setTool);
  const heatmapMode = useGameStore((s) => s.heatmapMode);
  const setHeatmapMode = useGameStore((s) => s.setHeatmapMode);
  const paused = useGameStore((s) => s.paused);
  const togglePaused = useGameStore((s) => s.togglePaused);
  const speed = useGameStore((s) => s.speed);
  const setSpeed = useGameStore((s) => s.setSpeed);
  const money = useGameStore((s) => s.stats.money);

  return (
    <aside className={`tool-panel ${className}`}>
      <div className="panel-heading">
        <span className="heading-icon"><Hammer size={16} /></span>
        <h2>Ferramentas</h2>
        <button className="panel-close" aria-label="Fechar ferramentas" onClick={onClose}><X size={17} /></button>
      </div>
      <div className="tool-list">
        {tools.map((tool) => {
          const disabled = tool.cost !== undefined && tool.id !== 'remove' && money < tool.cost;
          return (
            <button
              key={tool.id}
              className={selectedTool === tool.id ? 'tool active' : 'tool'}
              disabled={disabled}
              title={disabled ? 'Dinheiro insuficiente' : tool.label}
              onClick={() => setTool(tool.id)}
            >
              <tool.Icon size={17} />
              <span>{tool.label}</span>
              {tool.cost !== undefined && <small>$ {tool.cost}</small>}
            </button>
          );
        })}
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
