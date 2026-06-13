import { BarChart3, Building2, Car, CircleDot, MapPin, Route, X } from 'lucide-react';
import { GameWorld } from '../game/engine/simulation';
import { useGameStore } from '../store/gameStore';
import { BUILDING_CONFIG, getBuildingLevelConfig } from '../game/config/buildingConfig';
import { ROAD_CONFIG } from '../game/config/roadConfig';
import { getTrafficLightOpenAxis } from '../game/systems/trafficLights';
import { TrafficChart } from './TrafficChart';

const trafficStateLabel = {
  moving: 'Movendo',
  queued: 'Em fila',
  intersection: 'Aguardando cruzamento',
  turning: 'Reduzindo na curva',
} as const;

const intersectionReasonLabel = {
  signal_red: 'Semáforo vermelho',
  signal_yellow: 'Semáforo amarelo',
  unsignalized_queue: 'Fila sem semáforo',
  right_turn_free: 'Conversão à direita livre',
  box_occupied: 'Caixa ocupada',
  exit_blocked: 'Saída bloqueada',
  roundabout_yield: 'Aguardando rotatória',
} as const;

const trafficLightPhaseLabel = {
  horizontalGreen: 'Horizontal verde',
  horizontalYellow: 'Horizontal amarelo',
  verticalGreen: 'Vertical verde',
  verticalYellow: 'Vertical amarelo',
  allRedClearance: 'Todos vermelho',
} as const;

const switchReasonLabel = {
  timer: 'Ciclo normal',
  adaptive: 'Adaptativo',
  emergency: 'Emergência anti-travamento',
  startup: 'Instalação / amarelo piscante',
} as const;

export function DetailsPanel({ world, className = '', onClose }: { world: GameWorld; className?: string; onClose?: () => void }) {
  const selected = useGameStore((s) => s.selected);
  const car = selected.kind === 'car' ? world.getCar(selected.carId) : undefined;
  const buildingUpgrade = selected.kind === 'building' ? world.getBuildingUpgradeStatus(selected.building) : undefined;
  const buildingLevelConfig = selected.kind === 'building' ? getBuildingLevelConfig(selected.building.type, selected.building.level) : undefined;
  const nextBuildingLevelConfig = selected.kind === 'building' && buildingUpgrade?.nextLevel
    ? getBuildingLevelConfig(selected.building.type, buildingUpgrade.nextLevel)
    : undefined;

  return (
    <aside className={`details-panel ${className}`}>
      <div className="panel-heading">
        <span className="heading-icon"><BarChart3 size={16} /></span>
        <h2>Detalhes</h2>
        <button className="panel-close" aria-label="Fechar detalhes" onClick={onClose}><X size={17} /></button>
      </div>
      {selected.kind === 'none' && <p className="muted">Selecione uma rua, prédio ou carro.</p>}

      <TrafficChart world={world} />

      {selected.kind === 'tile' && (
        <div className="detail-card">
          <h3><CircleDot size={15} /> Tile vazio</h3>
          <p><span>Coordenada</span><strong>{selected.x}, {selected.y}</strong></p>
          <p className="muted">Use Rua ou Avenida para conectar prédios.</p>
        </div>
      )}

      {selected.kind === 'building' && (
        <div className="detail-card">
          <h3><Building2 size={15} /> {buildingLevelConfig?.label ?? BUILDING_CONFIG[selected.building.type].label}</h3>
          <p><span>Status</span><strong className={selected.building.connected ? 'good' : 'bad'}>{selected.building.connected ? 'Conectado' : 'Desconectado'}</strong></p>
          <p><span>Nível da construção</span><strong>{selected.building.level}/3</strong></p>
          <p><span>População</span><strong>{selected.building.population}</strong></p>
          <p><span>Empregos</span><strong>{selected.building.jobs}</strong></p>
          <p><span>Atração</span><strong>{selected.building.attraction}</strong></p>
          <p><span>Viagens hoje</span><strong>{selected.building.tripsToday}</strong></p>
          <p><span>Posição</span><strong>{selected.building.x}, {selected.building.y}</strong></p>
          <div className="upgrade-box">
            <div>
              <span>Melhoria</span>
              <strong className={buildingUpgrade?.canUpgrade ? 'good' : selected.building.level === 3 ? 'good' : 'warn'}>
                {buildingUpgrade?.reason ?? 'Avaliando'}
              </strong>
            </div>
            {nextBuildingLevelConfig ? (
              <>
                <p><span>Próximo nível</span><strong>{nextBuildingLevelConfig.label}</strong></p>
                <p><span>Benefício</span><strong>+{Math.max(0, nextBuildingLevelConfig.population - selected.building.population)} pop · +{Math.max(0, nextBuildingLevelConfig.jobs - selected.building.jobs)} emp · +{Math.max(0, nextBuildingLevelConfig.attraction - selected.building.attraction)} atr</strong></p>
                <p><span>Atividade</span><strong>{buildingUpgrade ? `${buildingUpgrade.score.toFixed(1)} pts` : '-'}</strong></p>
              </>
            ) : (
              <p><span>Próximo nível</span><strong>Máximo</strong></p>
            )}
          </div>
        </div>
      )}

      {selected.kind === 'road' && (
        <div className="detail-card">
          <h3><Route size={15} /> {ROAD_CONFIG[selected.roadType].label}</h3>
          <p><span>Posição</span><strong>{selected.x}, {selected.y}</strong></p>
          <p><span>Capacidade</span><strong>{selected.traffic.capacity}</strong></p>
          <p><span>Carros atuais</span><strong>{selected.traffic.cars}</strong></p>
          <p><span>Congestionamento</span><strong>{Math.round(selected.traffic.congestion * 100)}%</strong></p>
          <p><span>Velocidade base</span><strong>{ROAD_CONFIG[selected.roadType].speed}x</strong></p>
          {selected.trafficLight && (
            <>
              <p><span>Semáforo</span><strong>{trafficLightPhaseLabel[selected.trafficLight.phase]}</strong></p>
              <p>
                <span>Faixa liberada</span>
                <strong>{selected.trafficLight.phase === 'allRedClearance' ? 'Nenhuma' : getTrafficLightOpenAxis(selected.trafficLight) === 'horizontal' ? 'Horizontal' : 'Vertical'}</strong>
              </p>
              <p><span>Tempo fase</span><strong>{selected.trafficLight.timer.toFixed(1)}s</strong></p>
              <p><span>Modo</span><strong>{switchReasonLabel[selected.trafficLight.lastSwitchReason]}</strong></p>
              {selected.trafficLight.startupSeconds > 0 && (
                <p><span>Amarelo piscante</span><strong>{selected.trafficLight.startupSeconds.toFixed(1)}s</strong></p>
              )}
              {selected.trafficLight.emergencySeconds > 0 && (
                <p><span>Anti-travamento</span><strong>{selected.trafficLight.emergencySeconds.toFixed(1)}s</strong></p>
              )}
            </>
          )}
        </div>
      )}

      {selected.kind === 'car' && car && (
        <div className="detail-card">
          <h3><Car size={15} /> Carro #{car.id}</h3>
          <p><span>Status</span><strong>{trafficStateLabel[car.trafficState]}</strong></p>
          {car.intersectionReason && <p><span>Motivo parada</span><strong>{intersectionReasonLabel[car.intersectionReason]}</strong></p>}
          <p><span>Origem</span><strong>{world.getBuilding(car.originBuildingId)?.type ?? '-'}</strong></p>
          <p><span>Destino</span><strong>{world.getBuilding(car.destinationBuildingId)?.type ?? '-'}</strong></p>
          <p><span>Tempo viagem</span><strong>{Math.round(car.travelTime)}s</strong></p>
          <p><span>Atraso</span><strong>{Math.round(car.delay)}s</strong></p>
          <p><span>Velocidade atual</span><strong>{car.currentSpeed.toFixed(1)} tiles/s</strong></p>
          <p><span>Velocidade alvo</span><strong>{car.targetSpeed.toFixed(1)} tiles/s</strong></p>
          <p><span>Faixa</span><strong>{car.laneIndex + 1}/{Math.max(1, car.laneCount / 2)}</strong></p>
          {car.intersectionWaitSeconds > 0 && (
            <p><span>Espera cruzamento</span><strong>{car.intersectionWaitSeconds.toFixed(1)}s</strong></p>
          )}
          {car.stuckSeconds > 0 && (
            <p><span>Tempo travado</span><strong>{car.stuckSeconds.toFixed(1)}s</strong></p>
          )}
          {car.intersectionQueuePosition && (
            <p><span>Fila cruzamento</span><strong>{car.intersectionQueuePosition}/{car.intersectionQueueLength ?? car.intersectionQueuePosition}</strong></p>
          )}
          {car.gridlockEscapeSeconds > 0 && (
            <p><span>Anti-travamento</span><strong>Prioridade ativa</strong></p>
          )}
          {car.rerouteCount > 0 && (
            <p><span>Rotas recalculadas</span><strong>{car.rerouteCount}</strong></p>
          )}
          {car.lastRerouteReason && (
            <p><span>Última decisão</span><strong>{car.lastRerouteReason}</strong></p>
          )}
          {car.signalTransitionGraceSeconds > 0 && (
            <p><span>Adaptação semáforo</span><strong>{car.signalTransitionGraceSeconds.toFixed(1)}s</strong></p>
          )}
          <p><span>Rota</span><strong>{car.route.length} tiles</strong></p>
        </div>
      )}

      <div className="detail-card muted-card">
        <h3><MapPin size={15} /> Objetivo sandbox</h3>
        <p>Mantenha a satisfação alta, conecte novos prédios e crie rotas alternativas para evitar colapso urbano.</p>
      </div>
    </aside>
  );
}
