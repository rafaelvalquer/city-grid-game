import { useMemo, useState, type PointerEvent } from 'react';
import { BarChart3, Building2, BusFront, Bike, Car, Route, Users, X, type LucideIcon } from 'lucide-react';
import type { GameWorld } from '../game/engine/simulation';
import type { CityHistorySample, TrafficHeatmapCell } from '../types/city.types';

type AnalyticsTab = 'growth' | 'traffic' | 'transit' | 'buildings' | 'trips';

const CHART_WIDTH = 640;
const CHART_HEIGHT = 190;
const CHART_LEFT = 22;
const CHART_RIGHT = 618;
const CHART_TOP = 18;
const CHART_BOTTOM = 166;

const tabs: Array<{ id: AnalyticsTab; label: string; Icon: LucideIcon }> = [
  { id: 'growth', label: 'Crescimento', Icon: Users },
  { id: 'traffic', label: 'Trânsito', Icon: Car },
  { id: 'transit', label: 'Transporte', Icon: BusFront },
  { id: 'buildings', label: 'Construções', Icon: Building2 },
  { id: 'trips', label: 'Viagens', Icon: Route },
];

const periodLabel: Record<string, string> = {
  morning: 'Manhã',
  noon: 'Almoço',
  afternoon: 'Tarde',
  evening: 'Pico da noite',
  night: 'Noite',
};

type MetricComparison = {
  referenceSample: CityHistorySample;
  label: string;
  description: string;
  hasComparison: boolean;
};

function getMetricComparison(samples: CityHistorySample[]): MetricComparison {
  const latest = samples[samples.length - 1];
  const fallback = latest ?? samples[0];

  if (!fallback) {
    return {
      referenceSample: emptyHistoryReference(),
      label: 'sem histórico',
      description: 'aguardando amostras históricas',
      hasComparison: false,
    };
  }

  if (samples.length < 2) {
    return {
      referenceSample: fallback,
      label: 'sem comparação ainda',
      description: 'aguardando a próxima amostra para comparação',
      hasComparison: false,
    };
  }

  const latestHour = absoluteHistoryHour(latest);
  const reference24h = [...samples]
    .reverse()
    .find((sample) => absoluteHistoryHour(sample) <= latestHour - 24);

  if (reference24h) {
    return {
      referenceSample: reference24h,
      label: 'nas últimas 24h',
      description: `comparando com ${formatSampleLabel(reference24h)}`,
      hasComparison: true,
    };
  }

  const previous = samples[samples.length - 2];
  return {
    referenceSample: previous,
    label: 'vs amostra anterior',
    description: `comparando com ${formatSampleLabel(previous)}`,
    hasComparison: true,
  };
}

function absoluteHistoryHour(sample: CityHistorySample): number {
  return (sample.day - 1) * 24 + sample.hour;
}

function emptyHistoryReference(): CityHistorySample {
  return {
    key: 'empty',
    day: 1,
    hour: 0,
    timeLabel: '00:00',
    dayPeriod: 'morning',
    population: 0,
    activeCars: 0,
    activeBuses: 0,
    waitingPassengers: 0,
    completedTrips: 0,
    failedTrips: 0,
    publicTripsCompleted: 0,
    carTripsAvoided: 0,
    bikeLaneTiles: 0,
    bikeLaneCoverageRatio: 0,
    bikeTripsCompleted: 0,
    bikeCarsAvoided: 0,
    activeBikeTrips: 0,
    metroTripsCompleted: 0,
    metroCarsAvoided: 0,
    metroPassengers: 0,
    metroPassengersWaiting: 0,
    metroStations: 0,
    metroLines: 0,
    metroTrains: 0,
    averageCongestion: 0,
    satisfaction: 0,
    averageTravelTime: 0,
    cityLevel: 1,
    buildingTypes: { house: 0, shop: 0, office: 0 },
    buildingLevels: { 1: 0, 2: 0, 3: 0 },
  };
}

export function AnalyticsPanel({ world, onClose }: { world: GameWorld; onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<AnalyticsTab>('growth');
  const samples = world.getHistorySamples();
  const latest = samples[samples.length - 1];
  const initial = samples[0];
  const comparison = getMetricComparison(samples);
  const content = useMemo(() => renderTab(activeTab, samples, world), [activeTab, samples, world]);

  return (
    <div className="analytics-overlay" role="dialog" aria-modal="true" aria-label="Análises históricas da cidade">
      <button className="analytics-scrim" aria-label="Fechar análises" onClick={onClose} />
      <section className="analytics-panel">
        <header className="analytics-header">
          <div>
            <h2><BarChart3 size={18} /> Análises da cidade</h2>
            <p>
              Histórico: Dia {initial?.day ?? 1} · {initial?.timeLabel ?? '06:00'} até Dia {latest?.day ?? 1} · {latest?.timeLabel ?? '06:00'} · Cards: {comparison.description}
            </p>
          </div>
          <button className="analytics-close" onClick={onClose} aria-label="Fechar análises"><X size={18} /></button>
        </header>

        <nav className="analytics-tabs" aria-label="Visualizações históricas">
          {tabs.map(({ id, label, Icon }) => (
            <button key={id} className={activeTab === id ? 'active' : ''} onClick={() => setActiveTab(id)}>
              <Icon size={15} />
              {label}
            </button>
          ))}
        </nav>

        {samples.length < 2 && (
          <div className="analytics-note">
            Os gráficos ficam mais úteis quando a simulação atravessa a próxima hora.
          </div>
        )}

        <div className="analytics-content">{content}</div>
      </section>
    </div>
  );
}

function renderTab(tab: AnalyticsTab, samples: CityHistorySample[], world: GameWorld) {
  const latest = samples[samples.length - 1];
  if (!latest) return <div className="analytics-empty">Sem amostras históricas ainda.</div>;

  if (tab === 'growth') {
    return (
      <>
        <MetricGrid samples={samples} metrics={[
          { label: 'População', value: latest.population, initial: samples[0].population },
          { label: 'Satisfação', value: `${latest.satisfaction}%`, initial: samples[0].satisfaction, currentNumeric: latest.satisfaction },
          { label: 'Nível da cidade', value: latest.cityLevel, initial: samples[0].cityLevel },
        ]} />
        <ChartCard title="População no período histórico" samples={samples} series={[{ label: 'População', color: 'accent', values: samples.map((s) => s.population) }]} />
        <ChartCard title="Satisfação e nível" samples={samples} series={[
          { label: 'Satisfação', color: 'good', values: samples.map((s) => s.satisfaction) },
          { label: 'Nível x 35', color: 'warn', values: samples.map((s) => s.cityLevel * 35) },
        ]} maxValue={100} />
      </>
    );
  }

  if (false && tab === 'traffic') {
    return (
      <>
        <MetricGrid samples={samples} metrics={[
          { label: 'Carros ativos', value: latest.activeCars, initial: samples[0].activeCars },
          { label: 'Congestionamento', value: `${latest.averageCongestion}%`, initial: samples[0].averageCongestion, currentNumeric: latest.averageCongestion },
          { label: 'Tempo médio', value: `${latest.averageTravelTime}s`, initial: samples[0].averageTravelTime, currentNumeric: latest.averageTravelTime },
        ]} />
        <ChartCard title="Carros na rua por horário" samples={samples} series={[{ label: 'Carros ativos', color: 'accent', values: samples.map((s) => s.activeCars) }]} />
        <ChartCard title="Congestionamento e tempo médio" samples={samples} series={[
          { label: 'Congestionamento', color: 'warn', values: samples.map((s) => s.averageCongestion) },
          { label: 'Tempo médio', color: 'bad', values: samples.map((s) => s.averageTravelTime) },
        ]} />
        <HourlyBars samples={samples} title="Média de carros por hora do dia" valueFor={(sample) => sample.activeCars} />
      </>
    );
  }

  if (tab === 'traffic') {
    return (
      <>
        <MetricGrid samples={samples} metrics={[
          { label: 'Carros ativos', value: latest.activeCars, initial: samples[0].activeCars },
          { label: 'Congestionamento', value: `${latest.averageCongestion}%`, initial: samples[0].averageCongestion, currentNumeric: latest.averageCongestion },
          { label: 'Tempo medio', value: `${latest.averageTravelTime}s`, initial: samples[0].averageTravelTime, currentNumeric: latest.averageTravelTime },
        ]} />
        <ChartCard title="Carros na rua por horario" samples={samples} series={[{ label: 'Carros ativos', color: 'accent', values: samples.map((s) => s.activeCars) }]} />
        <ChartCard title="Congestionamento e tempo medio" samples={samples} series={[
          { label: 'Congestionamento', color: 'warn', values: samples.map((s) => s.averageCongestion) },
          { label: 'Tempo medio', color: 'bad', values: samples.map((s) => s.averageTravelTime) },
        ]} />
        <HourlyBars samples={samples} title="Media de carros por hora do dia" valueFor={(sample) => sample.activeCars} />
        <TrafficHeatmapMap world={world} />
      </>
    );
  }

  if (tab === 'transit') {
    return (
      <>
        <MetricGrid samples={samples} metrics={[
          { label: 'Ônibus ativos', value: latest.activeBuses, initial: samples[0].activeBuses },
          { label: 'Passageiros esperando', value: latest.waitingPassengers, initial: samples[0].waitingPassengers },
          { label: 'Carros evitados', value: latest.carTripsAvoided, initial: samples[0].carTripsAvoided },
          { label: 'Viagens de metrô', value: latest.metroTripsCompleted ?? 0, initial: samples[0].metroTripsCompleted ?? 0 },
          { label: 'Carros evitados pelo metrô', value: latest.metroCarsAvoided ?? 0, initial: samples[0].metroCarsAvoided ?? 0 },
          { label: 'Viagens de bicicleta', value: latest.bikeTripsCompleted ?? 0, initial: samples[0].bikeTripsCompleted ?? 0 },
          { label: 'Carros evitados por bicicleta', value: latest.bikeCarsAvoided ?? 0, initial: samples[0].bikeCarsAvoided ?? 0 },
        ]} />
        <BikeAnalyticsCard world={world} latest={latest} />
        <MetroAnalyticsCard world={world} latest={latest} />
        <ChartCard title="Fila e frota" samples={samples} series={[
          { label: 'Passageiros esperando', color: 'warn', values: samples.map((s) => s.waitingPassengers) },
          { label: 'Ônibus ativos x 12', color: 'accent', values: samples.map((s) => s.activeBuses * 12) },
        ]} />
        <ChartCard title="Impacto do transporte público" samples={samples} series={[
          { label: 'Viagens por ônibus', color: 'good', values: samples.map((s) => s.publicTripsCompleted) },
          { label: 'Viagens por metrô', color: 'accent', values: samples.map((s) => s.metroTripsCompleted ?? 0) },
          { label: 'Viagens por bicicleta', color: 'good', values: samples.map((s) => s.bikeTripsCompleted ?? 0) },
          { label: 'Carros evitados', color: 'warn', values: samples.map((s) => s.carTripsAvoided) },
        ]} />
        <ChartCard title="Metrô: demanda e operação" samples={samples} series={[
          { label: 'Passageiros metrô', color: 'accent', values: samples.map((s) => s.metroPassengers ?? 0) },
          { label: 'Esperando no metrô', color: 'warn', values: samples.map((s) => s.metroPassengersWaiting ?? 0) },
          { label: 'Trens x 30', color: 'good', values: samples.map((s) => (s.metroTrains ?? 0) * 30) },
        ]} />
      </>
    );
  }

  if (tab === 'buildings') {
    const typeBars: Array<{ label: string; value: number; color: ChartColor }> = [
      { label: 'Casas', value: latest.buildingTypes.house, color: 'good' },
      { label: 'Comércio', value: latest.buildingTypes.shop, color: 'warn' },
      { label: 'Escritórios', value: latest.buildingTypes.office, color: 'accent' },
    ];
    const levelBars: Array<{ label: string; value: number; color: ChartColor }> = [
      { label: 'Nível 1', value: latest.buildingLevels[1], color: 'muted' },
      { label: 'Nível 2', value: latest.buildingLevels[2], color: 'accent' },
      { label: 'Nível 3', value: latest.buildingLevels[3], color: 'good' },
    ];
    return (
      <>
        <MetricGrid samples={samples} metrics={[
          { label: 'Construções', value: latest.buildingTypes.house + latest.buildingTypes.shop + latest.buildingTypes.office, initial: samples[0].buildingTypes.house + samples[0].buildingTypes.shop + samples[0].buildingTypes.office },
          { label: 'Casas', value: latest.buildingTypes.house, initial: samples[0].buildingTypes.house },
          { label: 'Empregos/serviços', value: latest.buildingTypes.shop + latest.buildingTypes.office, initial: samples[0].buildingTypes.shop + samples[0].buildingTypes.office },
        ]} />
        <DistributionCard title="Construções por tipo" bars={typeBars} />
        <DistributionCard title="Construções por nível" bars={levelBars} />
        <ChartCard title="Evolução de casas, comércio e escritórios" samples={samples} series={[
          { label: 'Casas', color: 'good', values: samples.map((s) => s.buildingTypes.house) },
          { label: 'Comércio', color: 'warn', values: samples.map((s) => s.buildingTypes.shop) },
          { label: 'Escritórios', color: 'accent', values: samples.map((s) => s.buildingTypes.office) },
        ]} />
      </>
    );
  }

  return (
    <>
      <MetricGrid samples={samples} metrics={[
        { label: 'Concluídas', value: latest.completedTrips, initial: samples[0].completedTrips },
        { label: 'Falhadas', value: latest.failedTrips, initial: samples[0].failedTrips },
        { label: 'Por ônibus', value: latest.publicTripsCompleted, initial: samples[0].publicTripsCompleted },
      ]} />
      <ChartCard title="Viagens acumuladas" samples={samples} series={[
        { label: 'Concluídas', color: 'good', values: samples.map((s) => s.completedTrips) },
        { label: 'Falhadas', color: 'bad', values: samples.map((s) => s.failedTrips) },
      ]} />
      <ChartCard title="Transporte público nas viagens" samples={samples} series={[
        { label: 'Viagens por ônibus', color: 'accent', values: samples.map((s) => s.publicTripsCompleted) },
        { label: 'Viagens por metrô', color: 'good', values: samples.map((s) => s.metroTripsCompleted ?? 0) },
        { label: 'Carros evitados', color: 'warn', values: samples.map((s) => s.carTripsAvoided) },
      ]} />
    </>
  );
}


function BikeAnalyticsCard({ world, latest }: { world: GameWorld; latest: CityHistorySample }) {
  const coverage = Math.round((latest.bikeLaneCoverageRatio ?? 0) * 100);
  return (
    <article className="analytics-card bike-analytics-card">
      <header>
        <h3><Bike size={16} /> Bicicleta</h3>
        <span>{latest.bikeLaneTiles ?? 0} tiles de ciclovia</span>
      </header>
      <div className="metro-analytics-grid">
        <p><span>Viagens de bicicleta</span><strong>{latest.bikeTripsCompleted ?? 0}</strong></p>
        <p><span>Carros evitados</span><strong>{latest.bikeCarsAvoided ?? 0}</strong></p>
        <p><span>Cobertura cicloviária</span><strong>{coverage}%</strong></p>
        <p><span>Bicicletas visuais</span><strong>{latest.activeBikeTrips ?? world.bikeTrips.length}</strong></p>
      </div>
    </article>
  );
}


function MetroAnalyticsCard({ world, latest }: { world: GameWorld; latest: CityHistorySample }) {
  const busiestStation = [...world.metroStations].sort((a, b) => b.waitingPassengers - a.waitingPassengers)[0];
  const busiestLine = [...world.metroLines].sort((a, b) => b.totalPassengers - a.totalPassengers)[0];
  return (
    <article className="analytics-card metro-analytics-card">
      <header>
        <h3>Metrô</h3>
        <span>{latest.metroLines ?? 0} linhas ativas</span>
      </header>
      <div className="metro-analytics-grid">
        <p><span>Estações</span><strong>{latest.metroStations ?? world.metroStations.length}</strong></p>
        <p><span>Trens</span><strong>{latest.metroTrains ?? world.metroTrains.length}</strong></p>
        <p><span>Passageiros aguardando</span><strong>{latest.metroPassengersWaiting ?? 0}</strong></p>
        <p><span>Viagens por metrô</span><strong>{latest.metroTripsCompleted ?? 0}</strong></p>
        <p><span>Carros evitados pelo metrô</span><strong>{latest.metroCarsAvoided ?? 0}</strong></p>
        <p><span>Linha mais usada</span><strong>{busiestLine ? busiestLine.name + ' (' + busiestLine.totalPassengers + ')' : 'Nenhuma'}</strong></p>
        <p><span>Estação mais carregada</span><strong>{busiestStation ? busiestStation.name + ' (' + busiestStation.waitingPassengers + ')' : 'Nenhuma'}</strong></p>
      </div>
    </article>
  );
}

function MetricGrid({ samples, metrics }: { samples: CityHistorySample[]; metrics: Array<{ label: string; value: number | string; initial: number; currentNumeric?: number }> }) {
  const comparison = getMetricComparison(samples);
  return (
    <div className="analytics-metrics">
      {metrics.map((metric) => {
        const numeric = metric.currentNumeric ?? (typeof metric.value === 'number' ? metric.value : metric.initial);
        const reference = referenceValueForMetric(metric.label, comparison.referenceSample, metric.initial);
        const delta = numeric - reference;
        return (
          <article className="analytics-metric" key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            <small className={delta > 0 ? 'good' : delta < 0 ? 'bad' : ''}>
              {comparison.hasComparison ? `${formatDelta(delta)} ${comparison.label}` : comparison.label}
            </small>
          </article>
        );
      })}
    </div>
  );
}

function referenceValueForMetric(label: string, sample: CityHistorySample, fallback: number): number {
  switch (label) {
    case 'População':
      return sample.population;
    case 'Satisfação':
      return sample.satisfaction;
    case 'Nível da cidade':
      return sample.cityLevel;
    case 'Carros ativos':
      return sample.activeCars;
    case 'Congestionamento':
      return sample.averageCongestion;
    case 'Tempo médio':
    case 'Tempo medio':
      return sample.averageTravelTime;
    case 'Ônibus ativos':
      return sample.activeBuses;
    case 'Passageiros esperando':
      return sample.waitingPassengers;
    case 'Carros evitados':
      return sample.carTripsAvoided;
    case 'Viagens de metrô':
      return sample.metroTripsCompleted ?? 0;
    case 'Carros evitados pelo metrô':
      return sample.metroCarsAvoided ?? 0;
    case 'Carros evitados por bicicleta':
      return sample.bikeCarsAvoided ?? 0;
    case 'Viagens de bicicleta':
      return sample.bikeTripsCompleted ?? 0;
    case 'Construções':
      return sample.buildingTypes.house + sample.buildingTypes.shop + sample.buildingTypes.office;
    case 'Casas':
      return sample.buildingTypes.house;
    case 'Empregos/serviços':
      return sample.buildingTypes.shop + sample.buildingTypes.office;
    case 'Concluídas':
      return sample.completedTrips;
    case 'Falhadas':
      return sample.failedTrips;
    case 'Por ônibus':
      return sample.publicTripsCompleted;
    default:
      return fallback;
  }
}type Series = {
  label: string;
  values: number[];
  color: 'accent' | 'good' | 'warn' | 'bad' | 'muted';
};

type ChartColor = Series['color'];

function ChartCard({ title, samples, series, maxValue }: { title: string; samples: CityHistorySample[]; series: Series[]; maxValue?: number }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const max = maxValue ?? Math.max(1, ...series.flatMap((item) => item.values));
  const hoverSample = hoverIndex === null ? undefined : samples[hoverIndex];
  const hoverX = hoverIndex === null ? 0 : xForIndex(hoverIndex, samples.length);
  const tooltipLeft = Math.max(14, Math.min(86, (hoverX / CHART_WIDTH) * 100));

  const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
    setHoverIndex(indexFromPointer(event, samples.length));
  };

  return (
    <article className="analytics-card analytics-chart-card">
      <header>
        <h3>{title}</h3>
        <span>{samples.length} amostras</span>
      </header>
      <svg
        className="analytics-chart"
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        role="img"
        aria-label={title}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setHoverIndex(null)}
      >
        <ChartGrid />
        {series.map((item) => (
          <polyline key={item.label} className={`analytics-line ${item.color}`} points={buildLine(item.values, max)} />
        ))}
        {hoverIndex !== null && (
          <>
            <line className="analytics-hover-line" x1={hoverX} y1={CHART_TOP} x2={hoverX} y2={CHART_BOTTOM} />
            {series.map((item) => {
              const point = pointFor(hoverIndex, item.values[hoverIndex] ?? 0, item.values.length, max);
              return <circle key={item.label} className={`analytics-hover-dot ${item.color}`} cx={point.x} cy={point.y} r="4.8" />;
            })}
          </>
        )}
        <rect className="analytics-hitbox" x="0" y="0" width={CHART_WIDTH} height={CHART_HEIGHT} />
      </svg>
      {hoverSample && hoverIndex !== null && (
        <div className="analytics-tooltip" style={{ left: `${tooltipLeft}%` }}>
          <strong>{formatSampleLabel(hoverSample)}</strong>
          {series.map((item) => (
            <span key={item.label}>
              <i className={item.color} />
              {item.label}: {formatTooltipValue(item.label, item.values[hoverIndex] ?? 0)}
            </span>
          ))}
        </div>
      )}
      <div className="analytics-legend">
        {series.map((item) => (
          <span key={item.label}><i className={item.color} /> {item.label}: {formatNumber(item.values[item.values.length - 1] ?? 0)}</span>
        ))}
      </div>
      <div className="analytics-axis">
        <span>{formatSampleLabel(samples[0])}</span>
        <span>{formatSampleLabel(samples[samples.length - 1])}</span>
      </div>
    </article>
  );
}

function DistributionCard({ title, bars }: { title: string; bars: Array<{ label: string; value: number; color: ChartColor }> }) {
  const max = Math.max(1, ...bars.map((bar) => bar.value));
  return (
    <article className="analytics-card">
      <header>
        <h3>{title}</h3>
        <span>{bars.reduce((sum, bar) => sum + bar.value, 0)} total</span>
      </header>
      <div className="analytics-bars">
        {bars.map((bar) => (
          <div className="analytics-bar-row" key={bar.label}>
            <span>{bar.label}</span>
            <div className="analytics-bar-track">
              <i className={bar.color} style={{ width: `${Math.max(4, (bar.value / max) * 100)}%` }} />
            </div>
            <strong>{bar.value}</strong>
          </div>
        ))}
      </div>
    </article>
  );
}

function HourlyBars({ samples, title, valueFor }: { samples: CityHistorySample[]; title: string; valueFor: (sample: CityHistorySample) => number }) {
  const [hoveredBucket, setHoveredBucket] = useState<number | null>(null);
  const buckets = Array.from({ length: 24 }, (_, hour) => {
    const values = samples.filter((sample) => sample.hour === hour).map(valueFor);
    const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    return { hour, average, period: periodLabel[samples.find((sample) => sample.hour === hour)?.dayPeriod ?? ''] ?? '' };
  });
  const max = Math.max(1, ...buckets.map((bucket) => bucket.average));
  const hovered = hoveredBucket === null ? undefined : buckets[hoveredBucket];
  const tooltipLeft = hoveredBucket === null ? 50 : Math.max(14, Math.min(86, ((hoveredBucket + 0.5) / 24) * 100));
  return (
    <article className="analytics-card analytics-chart-card">
      <header>
        <h3>{title}</h3>
        <span>24h</span>
      </header>
      <div
        className="analytics-hour-bars"
        onPointerMove={(event) => setHoveredBucket(indexFromHourlyPointer(event))}
        onPointerLeave={() => setHoveredBucket(null)}
      >
        {buckets.map((bucket, index) => (
          <div className="analytics-hour" key={bucket.hour} title={`${String(bucket.hour).padStart(2, '0')}:00 · ${bucket.period}`}>
            <i style={{ height: `${Math.max(3, (bucket.average / max) * 100)}%` }} />
            <span>{bucket.hour % 3 === 0 ? bucket.hour : ''}</span>
          </div>
        ))}
      </div>
      {hovered && (
        <div className="analytics-tooltip analytics-hour-tooltip" style={{ left: `${tooltipLeft}%` }}>
          <strong>{String(hovered.hour).padStart(2, '0')}:00 {hovered.period ? `· ${hovered.period}` : ''}</strong>
          <span><i className="accent" /> Média: {formatNumber(hovered.average)}</span>
        </div>
      )}
    </article>
  );
}

function TrafficHeatmapMap({ world }: { world: GameWorld }) {
  const [hovered, setHovered] = useState<TrafficHeatmapCell | undefined>();
  const summary = world.getTrafficHeatmapLast24h();
  const { minX, minY, maxX, maxY } = summary.bounds;
  const cellSize = 12;
  const cols = Math.max(1, maxX - minX + 1);
  const rows = Math.max(1, maxY - minY + 1);
  const heatmapCells = new Map(summary.cells.map((cell) => [`${cell.x},${cell.y}`, cell]));
  const roadTiles: Array<{ x: number; y: number; type: string; heat?: TrafficHeatmapCell }> = [];

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const tile = world.grid[y]?.[x];
      if (!tile || !isAnalyticsRoadTile(tile.type)) continue;
      roadTiles.push({ x, y, type: tile.type, heat: heatmapCells.get(`${x},${y}`) });
    }
  }

  return (
    <article className="analytics-card analytics-heatmap-card">
      <header>
        <h3>Mapa de calor das ultimas 24h</h3>
        <span>{summary.cells.length} vias com trafego</span>
      </header>
      <div className="analytics-heatmap-wrap">
        <svg
          className="analytics-heatmap-map"
          viewBox={`0 0 ${cols * cellSize} ${rows * cellSize}`}
          role="img"
          aria-label="Mapa de calor de trafego das ultimas 24 horas"
          onPointerLeave={() => setHovered(undefined)}
        >
          {roadTiles.map((tile) => {
            const heat = tile.heat;
            const intensity = heat ? heat.weight / summary.maxWeight : 0;
            return (
              <rect
                key={`${tile.x},${tile.y}`}
                className={`analytics-heatmap-cell ${hovered?.x === tile.x && hovered?.y === tile.y ? 'active' : ''}`}
                x={(tile.x - minX) * cellSize + 1}
                y={(tile.y - minY) * cellSize + 1}
                width={cellSize - 2}
                height={cellSize - 2}
                rx={tile.type === 'roundabout' || tile.type === 'roundaboutCenter' ? 3 : 1.5}
                fill={heatColor(intensity)}
                opacity={heat ? 0.92 : 0.32}
                onPointerEnter={() => setHovered(heat)}
                onPointerMove={() => setHovered(heat)}
              />
            );
          })}
        </svg>
        {hovered && (
          <div
            className="analytics-tooltip analytics-heatmap-tooltip"
            style={{
              left: `${Math.max(14, Math.min(86, ((hovered.x - minX + 0.5) / cols) * 100))}%`,
              top: `${Math.max(18, Math.min(82, ((hovered.y - minY + 0.5) / rows) * 100))}%`,
            }}
          >
            <strong>Rua {hovered.x}, {hovered.y}</strong>
            <span><i className="accent" /> Indice 24h: {formatNumber(hovered.weight)}</span>
            <span><i className="warn" /> Carros med.: {formatNumber(hovered.carsAverage)}</span>
            <span><i className="bad" /> Cong.: {formatNumber(hovered.congestionAverage * 100)}%</span>
          </div>
        )}
      </div>
      <div className="analytics-heatmap-legend">
        <span><i className="low" /> Baixo</span>
        <span><i className="mid" /> Medio</span>
        <span><i className="high" /> Alto</span>
      </div>
    </article>
  );
}

function ChartGrid() {
  return (
    <>
      {[35, 75, 115, 155].map((y) => <line key={y} className="analytics-grid-line" x1="22" y1={y} x2="618" y2={y} />)}
      {[120, 240, 360, 480].map((x) => <line key={x} className="analytics-grid-line" x1={x} y1="18" x2={x} y2="166" />)}
    </>
  );
}

function buildLine(values: number[], maxValue: number): string {
  if (!values.length) return '';
  return values.map((value, index) => {
    const { x, y } = pointFor(index, value, values.length, maxValue);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

function indexFromPointer(event: PointerEvent<SVGSVGElement>, sampleCount: number): number {
  if (sampleCount <= 1) return 0;
  const bounds = event.currentTarget.getBoundingClientRect();
  const chartX = ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * CHART_WIDTH;
  const ratio = (Math.max(CHART_LEFT, Math.min(CHART_RIGHT, chartX)) - CHART_LEFT) / (CHART_RIGHT - CHART_LEFT);
  return Math.max(0, Math.min(sampleCount - 1, Math.round(ratio * (sampleCount - 1))));
}

function indexFromHourlyPointer(event: PointerEvent<HTMLDivElement>): number {
  const bounds = event.currentTarget.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / Math.max(1, bounds.width)));
  return Math.max(0, Math.min(23, Math.floor(ratio * 24)));
}

function pointFor(index: number, value: number, length: number, maxValue: number): { x: number; y: number } {
  const x = xForIndex(index, length);
  const ratio = Math.max(0, Math.min(1, value / Math.max(1, maxValue)));
  const y = CHART_BOTTOM - ratio * (CHART_BOTTOM - CHART_TOP);
  return { x, y };
}

function xForIndex(index: number, length: number): number {
  if (length <= 1) return CHART_LEFT;
  return CHART_LEFT + (index / (length - 1)) * (CHART_RIGHT - CHART_LEFT);
}

function formatSampleLabel(sample?: CityHistorySample): string {
  if (!sample) return '-';
  return `Dia ${sample.day} · ${sample.timeLabel}`;
}

function formatDelta(delta: number): string {
  if (delta > 0) return `+${formatNumber(delta)}`;
  if (delta < 0) return formatNumber(delta);
  return '0';
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatTooltipValue(label: string, value: number): string {
  if (label.includes('Congestionamento') || label.includes('Satisfa')) return `${formatNumber(value)}%`;
  if (label.includes('Tempo')) return `${formatNumber(value)}s`;
  return formatNumber(value);
}

function isAnalyticsRoadTile(type: string): boolean {
  return type === 'road' || type === 'avenue' || type === 'roundabout' || type === 'roundaboutCenter';
}

function heatColor(intensity: number): string {
  const value = Math.max(0, Math.min(1, intensity));
  if (value <= 0) return '#263850';
  if (value < 0.34) return '#4fb6ff';
  if (value < 0.68) return '#f4c542';
  return '#f26464';
}
