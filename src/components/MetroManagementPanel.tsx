import { useMemo, useState } from 'react';
import { Trash2, TrainFront, X } from 'lucide-react';
import { useGameStore } from '../store/gameStore';
import type { GameWorld } from '../game/engine/simulation';

export function MetroManagementPanel({ world, onClose }: { world: GameWorld; onClose: () => void }) {
  const [expandedLineId, setExpandedLineId] = useState<string | null>(world.metroLines[0]?.id ?? null);
  const setActionFeedback = useGameStore((s) => s.setActionFeedback);
  const lines = world.metroLines;
  const totals = useMemo(() => ({
    lines: world.metroLines.length,
    stations: world.metroStations.length,
    trains: world.metroTrains.length,
    waiting: world.metroStations.reduce((sum, station) => sum + station.waitingPassengers, 0),
    passengers: world.metroLines.reduce((sum, line) => sum + line.totalPassengers, 0),
    avoided: world.metroLines.reduce((sum, line) => sum + line.carsAvoided, 0),
  }), [world, world.metroLines.length, world.metroStations.length, world.metroTrains.length]);

  const deleteLine = (lineId: string) => {
    const line = world.metroLines.find((candidate) => candidate.id === lineId);
    const name = line?.name ?? 'Linha';
    const confirmed = window.confirm(`${name}: excluir linha? Trilhos e estações serão mantidos; os trens da linha serão removidos.`);
    if (!confirmed) return;
    const ok = world.deleteMetroLine(lineId);
    setActionFeedback(ok ? `${name} excluída. Estações e trilhos foram mantidos.` : 'Não foi possível excluir a linha.');
    if (expandedLineId === lineId) setExpandedLineId(null);
  };

  return (
    <section className="metro-management-panel" aria-label="Gerenciamento de linhas de metrô">
      <header>
        <div>
          <h2><TrainFront size={18} /> Gerenciar metrô</h2>
          <p>{totals.lines} linha(s), {totals.stations} estação(ões), {totals.trains} trem(ns)</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Fechar gerenciamento de metrô"><X size={18} /></button>
      </header>

      <div className="metro-management-summary">
        <span><strong>{totals.passengers}</strong><small>passageiros</small></span>
        <span><strong>{totals.waiting}</strong><small>aguardando</small></span>
        <span><strong>{totals.avoided}</strong><small>carros evitados</small></span>
      </div>

      {!lines.length && (
        <p className="muted">Nenhuma linha criada. No modo Subsolo, use Criar linha e selecione duas estações conectadas por trilhos.</p>
      )}

      <div className="metro-line-list">
        {lines.map((line) => {
          const stats = world.getMetroLineStats(line.id);
          const expanded = expandedLineId === line.id;
          const stations = line.stationIds.map((stationId) => world.getMetroStation(stationId)).filter(Boolean);
          return (
            <article className="metro-line-card" key={line.id}>
              <button className="metro-line-main" type="button" onClick={() => setExpandedLineId(expanded ? null : line.id)}>
                <i style={{ background: line.color }} />
                <span>
                  <strong>{line.name}</strong>
                  <small>{stats?.stations ?? line.stationIds.length} estações · {stats?.trains ?? 0} trem(ns)</small>
                </span>
              </button>
              <div className="metro-line-kpis">
                <span>{stats?.currentPassengers ?? 0}<small>no trem</small></span>
                <span>{stats?.waitingPassengers ?? 0}<small>esperando</small></span>
                <span>{stats?.totalPassengers ?? line.totalPassengers}<small>total</small></span>
                <span>{stats?.carsAvoided ?? line.carsAvoided}<small>evitados</small></span>
              </div>
              {expanded && (
                <div className="metro-line-details">
                  <p><span>Sequência</span><strong>{stations.map((station) => station?.name).join(' → ')}</strong></p>
                  <div className="metro-station-list">
                    {stations.map((station) => station && (
                      <div key={station.id}>
                        <strong>{station.name}</strong>
                        <small>{station.waitingPassengers} esperando · {station.totalBoarded} embarques · {station.totalAlighted} desembarques</small>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <button className="metro-line-delete" type="button" onClick={() => deleteLine(line.id)}>
                <Trash2 size={14} /> Excluir linha
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
