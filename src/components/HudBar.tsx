import { Banknote, Car, Clock3, Gauge, HeartPulse, TrendingUp, Users } from 'lucide-react';
import { useGameStore } from '../store/gameStore';

const periodLabel: Record<string, string> = {
  morning: 'Manhã',
  noon: 'Almoço',
  afternoon: 'Tarde',
  evening: 'Pico da noite',
  night: 'Noite',
};

function levelClass(value: number, warnAt: number, badAt: number, inverse = false): string {
  if (inverse) {
    if (value >= badAt) return 'bad';
    if (value >= warnAt) return 'warn';
    return 'good';
  }
  if (value <= badAt) return 'bad';
  if (value <= warnAt) return 'warn';
  return 'good';
}

export function HudBar() {
  const stats = useGameStore((s) => s.stats);
  return (
    <header className="hud-bar">
      <div className="brand">
        <span className="brand-mark">CF</span>
        <span>
          <strong>Cidade em Fluxo</strong>
          <small>Nível {stats.cityLevel}</small>
        </span>
      </div>
      <div className="hud-cluster primary">
        <div className="hud-item money"><Banknote size={16} /><span>$ {stats.money}</span></div>
        <div className="hud-item"><Users size={16} /><span>{stats.population}</span><small>pop</small></div>
        <div className="hud-item"><Car size={16} /><span>{stats.activeCars}</span><small>carros</small></div>
      </div>
      <div className="hud-cluster">
        <div className={`hud-item signal ${levelClass(stats.satisfaction, 62, 35)}`}>
          <HeartPulse size={16} /><span>{stats.satisfaction}%</span><small>satisfação</small>
        </div>
        <div className={`hud-item signal ${levelClass(stats.averageCongestion, 55, 95, true)}`}>
          <Gauge size={16} /><span>{stats.averageCongestion}%</span><small>trânsito</small>
        </div>
        <div className="hud-item"><TrendingUp size={16} /><span>{stats.averageTravelTime}s</span><small>tempo médio</small></div>
      </div>
      <div className="hud-item time"><Clock3 size={16} /><span>{stats.timeLabel}</span><small>{periodLabel[stats.dayPeriod] ?? stats.dayPeriod}</small></div>
    </header>
  );
}
