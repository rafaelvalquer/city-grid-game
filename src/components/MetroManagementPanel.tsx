import { useMemo, useState } from 'react';
import { BusFront, Minus, Plane, Plus, Trash2, TrainFront, X } from 'lucide-react';
import { useGameStore } from '../store/gameStore';
import type { GameWorld } from '../game/engine/simulation';

export function MetroManagementPanel({ world, onClose }: { world: GameWorld; onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<'bus' | 'metro' | 'helicopter'>('bus');
  const [expandedLineId, setExpandedLineId] = useState<string | null>(world.metroLines[0]?.id ?? null);
  const setFeedback = useGameStore((s) => s.setActionFeedback);
  const stats = useGameStore((s) => s.stats);
  const transit = world.getTransitLineStats();
  const metroTotals = useMemo(() => ({
    waiting: world.metroStations.reduce((sum, station) => sum + station.waitingPassengers, 0),
    passengers: world.metroLines.reduce((sum, line) => sum + line.totalPassengers, 0),
    avoided: world.metroLines.reduce((sum, line) => sum + line.carsAvoided, 0),
  }), [world, stats.metroLines, stats.metroStations, stats.metroPassengersWaiting]);

  const changeBusCount = (delta: number) => {
    const result = world.setTransitBusCount(transit.busCount + delta);
    setFeedback(result.success
      ? `Frota de ônibus ajustada para ${result.count}/${result.max}${result.cost ? ` por $ ${result.cost}` : ''}.`
      : result.reason ?? 'Não foi possível alterar a frota de ônibus.');
  };

  const changeHelicopterCount = (lineId: string, delta: number) => {
    const current = world.helicopters.filter((helicopter) => helicopter.lineId === lineId).length;
    const result = world.setHelicopterCount(lineId, current + delta);
    setFeedback(result.success
      ? `Frota aérea ajustada para ${result.count}${result.cost ? ` por $ ${result.cost}` : ''}.`
      : result.reason ?? 'Não foi possível alterar a frota aérea.');
  };

  const deleteMetroLine = (lineId: string) => {
    const line = world.metroLines.find((candidate) => candidate.id === lineId);
    if (!window.confirm(`${line?.name ?? 'Linha'}: excluir linha?`)) return;
    setFeedback(world.deleteMetroLine(lineId) ? 'Linha de metrô excluída.' : 'Não foi possível excluir a linha.');
  };

  const deleteAirLine = (lineId: string) => {
    const line = world.helicopterLines.find((candidate) => candidate.id === lineId);
    if (!window.confirm(`${line?.name ?? 'Linha aérea'}: excluir linha e aeronaves?`)) return;
    setFeedback(world.deleteHelicopterLine(lineId) ? 'Linha aérea excluída.' : 'Não foi possível excluir a linha aérea.');
  };

  return (
    <section className="metro-management-panel" aria-label="Gerenciamento de linhas">
      <header>
        <div>
          <h2>{activeTab === 'bus' ? <BusFront size={18} /> : activeTab === 'metro' ? <TrainFront size={18} /> : <Plane size={18} />} Gerenciar linhas</h2>
          <p>Ônibus, metrô e transporte aéreo</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Fechar gerenciamento"><X size={18} /></button>
      </header>
      <div className="mobility-tabs" role="tablist" aria-label="Tipo de linha">
        <button type="button" className={activeTab === 'bus' ? 'active' : ''} onClick={() => setActiveTab('bus')}><BusFront size={15} /> Ônibus</button>
        <button type="button" className={activeTab === 'metro' ? 'active' : ''} onClick={() => setActiveTab('metro')}><TrainFront size={15} /> Metrô</button>
        <button type="button" className={activeTab === 'helicopter' ? 'active' : ''} onClick={() => setActiveTab('helicopter')}><Plane size={15} /> Aéreo</button>
      </div>

      {activeTab === 'bus' && (
        <div className="bus-management-tab">
          <Summary values={[[transit.activeBuses, 'ativos'], [transit.waitingPassengers, 'aguardando'], [`${Math.round(transit.busLaneCoverageRatio * 100)}%`, 'em corredor']]} />
          <article className="bus-line-card">
            <div className="bus-line-heading">
              <div><h3>Linha circular de ônibus</h3><p className={transit.active ? 'good' : 'warn'}>{transit.active ? 'Ativa' : transit.reason}</p></div>
              <strong>{transit.busCount}/{transit.maxBuses} ônibus</strong>
            </div>
            <div className="mobility-kpi-grid">
              <span><strong>{transit.stops}</strong><small>pontos</small></span>
              <span><strong>{transit.routeTiles}</strong><small>tiles</small></span>
              <span><strong>{transit.passengers}</strong><small>passageiros</small></span>
              <span><strong>{transit.carsAvoided}</strong><small>evitados</small></span>
            </div>
            <div className="bus-line-actions">
              <button type="button" onClick={() => changeBusCount(-1)} disabled={transit.busCount <= 1}><Minus size={14} /> Remover</button>
              <button type="button" onClick={() => changeBusCount(1)} disabled={transit.busCount >= transit.maxBuses}><Plus size={14} /> Adicionar</button>
            </div>
          </article>
        </div>
      )}

      {activeTab === 'metro' && (
        <>
          <Summary values={[[metroTotals.passengers, 'passageiros'], [metroTotals.waiting, 'aguardando'], [metroTotals.avoided, 'evitados']]} />
          {!world.metroLines.length && <p className="muted">Nenhuma linha de metrô criada.</p>}
          <div className="metro-line-list">
            {world.metroLines.map((line) => {
              const lineStats = world.getMetroLineStats(line.id);
              const expanded = expandedLineId === line.id;
              const stations = line.stationIds.map((id) => world.getMetroStation(id)).filter(Boolean);
              return (
                <article className="metro-line-card" key={line.id}>
                  <button className="metro-line-main" type="button" onClick={() => setExpandedLineId(expanded ? null : line.id)}>
                    <i style={{ background: line.color }} /><span><strong>{line.name}</strong><small>{lineStats?.stations} estações · {lineStats?.trains} trem(ns)</small></span>
                  </button>
                  <LineKpis current={lineStats?.currentPassengers ?? 0} waiting={lineStats?.waitingPassengers ?? 0} total={line.totalPassengers} avoided={line.carsAvoided} />
                  {expanded && <div className="metro-line-details"><p><span>Sequência</span><strong>{stations.map((station) => station?.name).join(' → ')}</strong></p></div>}
                  <button className="metro-line-delete" type="button" onClick={() => deleteMetroLine(line.id)}><Trash2 size={14} /> Excluir linha</button>
                </article>
              );
            })}
          </div>
        </>
      )}

      {activeTab === 'helicopter' && (
        <>
          <Summary values={[[world.helipads.length, 'helipontos'], [world.helicopters.length, 'aeronaves'], [stats.helicopterPassengersWaiting, 'aguardando']]} />
          {!world.helicopterLines.length && <p className="muted">Construa dois helipontos e conecte-os com uma linha aérea.</p>}
          <div className="metro-line-list">
            {world.helicopterLines.map((line) => {
              const lineStats = world.getHelicopterLineStats(line.id);
              const pads = line.helipadIds.map((id) => world.getHelipad(id)).filter(Boolean);
              const fleet = lineStats?.helicopters ?? 0;
              return (
                <article className="metro-line-card" key={line.id}>
                  <button className="metro-line-main" type="button" onClick={() => world.inspectHelicopterLine(line.id)}>
                    <i style={{ background: line.color }} /><span><strong>{line.name}</strong><small>{pads.map((pad) => pad?.name).join(' ↔ ')}</small></span>
                  </button>
                  <LineKpis current={lineStats?.currentPassengers ?? 0} waiting={lineStats?.waitingPassengers ?? 0} total={line.totalPassengers} avoided={line.carsAvoided} />
                  <div className="bus-line-actions">
                    <button type="button" onClick={() => changeHelicopterCount(line.id, -1)} disabled={fleet <= 1}><Minus size={14} /> Remover</button>
                    <button type="button" onClick={() => changeHelicopterCount(line.id, 1)} disabled={fleet >= 3}><Plus size={14} /> Adicionar</button>
                  </div>
                  <button className="metro-line-delete" type="button" onClick={() => deleteAirLine(line.id)}><Trash2 size={14} /> Excluir linha</button>
                </article>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

function Summary({ values }: { values: Array<[number | string, string]> }) {
  return <div className="metro-management-summary">{values.map(([value, label]) => <span key={label}><strong>{value}</strong><small>{label}</small></span>)}</div>;
}

function LineKpis({ current, waiting, total, avoided }: { current: number; waiting: number; total: number; avoided: number }) {
  return <div className="metro-line-kpis"><span>{current}<small>em trânsito</small></span><span>{waiting}<small>esperando</small></span><span>{total}<small>gerados</small></span><span>{avoided}<small>evitados</small></span></div>;
}
