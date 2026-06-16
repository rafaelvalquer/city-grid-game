import { useMemo, useState } from 'react';
import { BusFront, Minus, Plus, Trash2, TrainFront, X } from 'lucide-react';
import { useGameStore } from '../store/gameStore';
import type { GameWorld } from '../game/engine/simulation';

export function MetroManagementPanel({ world, onClose }: { world: GameWorld; onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<'bus' | 'metro'>('bus');
  const [expandedLineId, setExpandedLineId] = useState<string | null>(world.metroLines[0]?.id ?? null);
  const setActionFeedback = useGameStore((s) => s.setActionFeedback);
  const stats = useGameStore((s) => s.stats);
  const lines = world.metroLines;
  const transitStats = world.getTransitLineStats();
  const totals = useMemo(() => ({
    lines: world.metroLines.length,
    stations: world.metroStations.length,
    trains: world.metroTrains.length,
    waiting: world.metroStations.reduce((sum, station) => sum + station.waitingPassengers, 0),
    passengers: world.metroLines.reduce((sum, line) => sum + line.totalPassengers, 0),
    avoided: world.metroLines.reduce((sum, line) => sum + line.carsAvoided, 0),
  }), [world, stats.metroLines, stats.metroStations, stats.metroTrains, stats.metroPassengersWaiting]);

  const changeBusCount = (delta: number) => {
    const result = world.setTransitBusCount(transitStats.busCount + delta);
    if (!result.success) {
      setActionFeedback(result.reason ?? 'Não foi possível alterar a frota de ônibus.');
      return;
    }
    if (delta > 0) setActionFeedback(`Frota de ônibus aumentada para ${result.count}/${result.max} por $ ${result.cost ?? 0}.`);
    else setActionFeedback(`Frota de ônibus reduzida para ${result.count}/${result.max}.`);
  };

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
    <section className="metro-management-panel" aria-label="Gerenciamento de linhas">
      <header>
        <div>
          <h2>{activeTab === 'bus' ? <BusFront size={18} /> : <TrainFront size={18} />} Gerenciar linhas</h2>
          <p>Ônibus e metrô em um painel</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Fechar gerenciamento de linhas"><X size={18} /></button>
      </header>

      <div className="mobility-tabs" role="tablist" aria-label="Tipo de linha">
        <button type="button" className={activeTab === 'bus' ? 'active' : ''} onClick={() => setActiveTab('bus')}>
          <BusFront size={15} /> Ônibus
        </button>
        <button type="button" className={activeTab === 'metro' ? 'active' : ''} onClick={() => setActiveTab('metro')}>
          <TrainFront size={15} /> Metrô
        </button>
      </div>

      {activeTab === 'bus' ? (
        <div className="bus-management-tab">
          <div className="metro-management-summary">
            <span><strong>{transitStats.activeBuses}</strong><small>ativos</small></span>
            <span><strong>{transitStats.waitingPassengers}</strong><small>aguardando</small></span>
            <span><strong>{Math.round(transitStats.busLaneCoverageRatio * 100)}%</strong><small>rota em corredor</small></span>
          </div>

          <article className="bus-line-card">
            <div className="bus-line-heading">
              <div>
                <h3>Linha circular de ônibus</h3>
                <p className={transitStats.active ? 'good' : 'warn'}>{transitStats.active ? 'Ativa' : transitStats.reason ?? 'Inativa'}</p>
              </div>
              <strong>{transitStats.busCount}/{transitStats.maxBuses} ônibus</strong>
            </div>

            <div className="mobility-kpi-grid">
              <span><strong>{transitStats.stops}</strong><small>pontos</small></span>
              <span><strong>{transitStats.routeTiles}</strong><small>tiles de rota</small></span>
              <span><strong>{transitStats.passengers}</strong><small>nos ônibus</small></span>
              <span><strong>{transitStats.carsAvoided}</strong><small>carros evitados</small></span>
            </div>

            <div className="bus-line-progress" aria-label="Cobertura por corredor de ônibus">
              <i style={{ width: `${Math.round(transitStats.busLaneCoverageRatio * 100)}%` }} />
            </div>
            <p className="muted">{transitStats.busLaneTiles} tiles da rota passam por corredor de ônibus.</p>

            <div className="bus-line-actions">
              <button type="button" onClick={() => changeBusCount(-1)} disabled={transitStats.busCount <= 1}>
                <Minus size={14} /> Remover ônibus
              </button>
              <button type="button" onClick={() => changeBusCount(1)} disabled={transitStats.busCount >= transitStats.maxBuses}>
                <Plus size={14} /> Adicionar ônibus $ {transitStats.purchaseCost}
              </button>
            </div>
          </article>
        </div>
      ) : (
        <>
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
              const lineStats = world.getMetroLineStats(line.id);
              const expanded = expandedLineId === line.id;
              const stations = line.stationIds.map((stationId) => world.getMetroStation(stationId)).filter(Boolean);
              return (
                <article className="metro-line-card" key={line.id}>
                  <button className="metro-line-main" type="button" onClick={() => setExpandedLineId(expanded ? null : line.id)}>
                    <i style={{ background: line.color }} />
                    <span>
                      <strong>{line.name}</strong>
                      <small>{lineStats?.stations ?? line.stationIds.length} estações · {lineStats?.trains ?? 0} trem(ns)</small>
                    </span>
                  </button>
                  <div className="metro-line-kpis">
                    <span>{lineStats?.currentPassengers ?? 0}<small>no trem</small></span>
                    <span>{lineStats?.waitingPassengers ?? 0}<small>esperando</small></span>
                    <span>{lineStats?.totalPassengers ?? line.totalPassengers}<small>total</small></span>
                    <span>{lineStats?.carsAvoided ?? line.carsAvoided}<small>evitados</small></span>
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
        </>
      )}
    </section>
  );
}
