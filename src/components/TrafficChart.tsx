import { useEffect, useMemo, useState } from 'react';
import { Activity } from 'lucide-react';
import type { GameWorld } from '../game/engine/simulation';

type TrafficSample = {
  activeCars: number;
  waitingCars: number;
  congestion: number;
};

const MAX_SAMPLES = 60;
const WIDTH = 240;
const HEIGHT = 92;
const PAD = 8;

export function TrafficChart({ world }: { world: GameWorld }) {
  const [samples, setSamples] = useState<TrafficSample[]>(() => [readTrafficSample(world)]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setSamples((current) => [...current.slice(-(MAX_SAMPLES - 1)), readTrafficSample(world)]);
    }, 500);
    return () => window.clearInterval(id);
  }, [world]);

  const latest = samples[samples.length - 1] ?? readTrafficSample(world);
  const maxCars = Math.max(12, ...samples.map((sample) => sample.activeCars), ...samples.map((sample) => sample.waitingCars));
  const carLine = useMemo(() => buildLine(samples.map((sample) => sample.activeCars), maxCars), [samples, maxCars]);
  const waitingLine = useMemo(() => buildLine(samples.map((sample) => sample.waitingCars), maxCars), [samples, maxCars]);
  const congestionArea = useMemo(() => buildArea(samples.map((sample) => sample.congestion), 100), [samples]);

  return (
    <div className="detail-card traffic-chart-card">
      <h3><Activity size={15} /> Tráfego em tempo real</h3>
      <svg className="traffic-chart" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Gráfico de carros ativos, carros aguardando e congestionamento">
        <path className="chart-area" d={congestionArea} />
        <polyline className="chart-line cars" points={carLine} />
        <polyline className="chart-line waiting" points={waitingLine} />
      </svg>
      <div className="chart-legend">
        <span><i className="cars" /> {latest.activeCars} ativos</span>
        <span><i className="waiting" /> {latest.waitingCars} em fila</span>
        <span><i className="congestion" /> {latest.congestion}% trânsito</span>
      </div>
    </div>
  );
}

function readTrafficSample(world: GameWorld): TrafficSample {
  const snapshot = world.getSnapshot();
  const waitingCars = world.cars.filter((car) => car.trafficState === 'queued' || car.trafficState === 'intersection').length;
  return {
    activeCars: snapshot.activeCars,
    waitingCars,
    congestion: snapshot.averageCongestion,
  };
}

function buildLine(values: number[], maxValue: number): string {
  return values.map((value, index) => `${xFor(index, values.length)},${yFor(value, maxValue)}`).join(' ');
}

function buildArea(values: number[], maxValue: number): string {
  if (!values.length) return '';
  const top = values.map((value, index) => `${xFor(index, values.length)},${yFor(value, maxValue)}`).join(' L ');
  return `M ${PAD},${HEIGHT - PAD} L ${top} L ${WIDTH - PAD},${HEIGHT - PAD} Z`;
}

function xFor(index: number, length: number): number {
  if (length <= 1) return PAD;
  return PAD + (index / (length - 1)) * (WIDTH - PAD * 2);
}

function yFor(value: number, maxValue: number): number {
  const ratio = Math.max(0, Math.min(1, value / Math.max(1, maxValue)));
  return HEIGHT - PAD - ratio * (HEIGHT - PAD * 2);
}
