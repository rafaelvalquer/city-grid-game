import { Bike, BusFront, Eye, TrainFront } from 'lucide-react';
import { useGameStore, type MobilityFocusMode } from '../store/gameStore';

const focusModes: Array<{ id: MobilityFocusMode; label: string; icon: typeof Eye }> = [
  { id: 'off', label: 'Normal', icon: Eye },
  { id: 'bike', label: 'Bicicletas', icon: Bike },
  { id: 'bus', label: 'Ônibus', icon: BusFront },
  { id: 'metro', label: 'Metrô', icon: TrainFront },
];

export function MobilityFocusToggle({ variant = 'panel' }: { variant?: 'panel' | 'floating' }) {
  const mode = useGameStore((s) => s.mobilityFocusMode);
  const setMode = useGameStore((s) => s.setMobilityFocusMode);
  const stats = useGameStore((s) => s.stats);

  return (
    <section className={variant === 'floating' ? 'mobility-focus-floating' : 'mobility-focus-panel'} aria-label="Foco de mobilidade">
      <div className="mobility-focus-heading">
        <span><Eye size={14} /> Foco de mobilidade</span>
        {mode !== 'off' && <strong>{focusModes.find((item) => item.id === mode)?.label}</strong>}
      </div>

      <div className="mobility-focus-grid" role="group" aria-label="Escolher foco de mobilidade">
        {focusModes.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className={mode === id ? 'mobility-focus-button active' : 'mobility-focus-button'}
            onClick={() => setMode(id)}
            aria-pressed={mode === id}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {mode !== 'off' && (
        <div className="mobility-focus-summary inline">
          {mode === 'bike' && (
            <>
              <span>Viagens: <strong>{stats.bikeTripsCompleted ?? 0}</strong></span>
              <span>Carros evitados: <strong>{stats.bikeCarsAvoided ?? 0}</strong></span>
              <span>Ciclovias: <strong>{stats.bikeLaneTiles ?? 0}</strong></span>
            </>
          )}
          {mode === 'bus' && (
            <>
              <span>Ônibus ativos: <strong>{stats.activeBuses ?? 0}</strong></span>
              <span>Passageiros: <strong>{stats.waitingPassengers ?? 0}</strong></span>
              <span>Corredores: <strong>{stats.busLaneTiles ?? 0}</strong></span>
            </>
          )}
          {mode === 'metro' && (
            <>
              <span>Estações: <strong>{stats.metroStations ?? 0}</strong></span>
              <span>Linhas: <strong>{stats.metroLines ?? 0}</strong></span>
              <span>Trens: <strong>{stats.metroTrains ?? 0}</strong></span>
            </>
          )}
        </div>
      )}
    </section>
  );
}
