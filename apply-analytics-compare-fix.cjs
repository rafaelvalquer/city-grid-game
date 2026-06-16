const fs = require('fs');
const path = require('path');

const root = process.cwd();
const target = path.join(root, 'src', 'components', 'AnalyticsPanel.tsx');
const backupSuffix = '.bak-analytics-compare-fix-v2';

function fail(message) {
  console.error(`Falha ao aplicar melhoria de comparação das análises:\n${message}`);
  process.exit(1);
}

function backup(filePath) {
  const backupPath = `${filePath}${backupSuffix}`;
  if (!fs.existsSync(backupPath)) {
    fs.copyFileSync(filePath, backupPath);
  }
}

function replaceOnce(source, search, replacement, label) {
  if (!source.includes(search)) {
    fail(`Trecho não encontrado: ${label}`);
  }
  return source.replace(search, replacement);
}

function block(lines) {
  return lines.join('\n');
}

if (!fs.existsSync(target)) {
  fail(`Arquivo não encontrado: ${path.relative(root, target)}`);
}

backup(target);
let content = fs.readFileSync(target, 'utf8');

if (!content.includes('function getMetricComparison(samples: CityHistorySample[])')) {
  const marker = block([
    "const periodLabel: Record<string, string> = {",
    "  morning: 'Manhã',",
    "  noon: 'Almoço',",
    "  afternoon: 'Tarde',",
    "  evening: 'Pico da noite',",
    "  night: 'Noite',",
    "};",
  ]);

  const helpers = block([
    marker,
    '',
    'type MetricComparison = {',
    '  referenceSample: CityHistorySample;',
    '  label: string;',
    '  description: string;',
    '  hasComparison: boolean;',
    '};',
    '',
    'function getMetricComparison(samples: CityHistorySample[]): MetricComparison {',
    '  const latest = samples[samples.length - 1];',
    '  const fallback = latest ?? samples[0];',
    '',
    '  if (!fallback) {',
    '    return {',
    '      referenceSample: emptyHistoryReference(),',
    "      label: 'sem histórico',",
    "      description: 'aguardando amostras históricas',",
    '      hasComparison: false,',
    '    };',
    '  }',
    '',
    '  if (samples.length < 2) {',
    '    return {',
    '      referenceSample: fallback,',
    "      label: 'sem comparação ainda',",
    "      description: 'aguardando a próxima amostra para comparação',",
    '      hasComparison: false,',
    '    };',
    '  }',
    '',
    '  const latestHour = absoluteHistoryHour(latest);',
    '  const reference24h = [...samples]',
    '    .reverse()',
    '    .find((sample) => absoluteHistoryHour(sample) <= latestHour - 24);',
    '',
    '  if (reference24h) {',
    '    return {',
    '      referenceSample: reference24h,',
    "      label: 'nas últimas 24h',",
    '      description: `comparando com ${formatSampleLabel(reference24h)}`,',
    '      hasComparison: true,',
    '    };',
    '  }',
    '',
    '  const previous = samples[samples.length - 2];',
    '  return {',
    '    referenceSample: previous,',
    "    label: 'vs amostra anterior',",
    '    description: `comparando com ${formatSampleLabel(previous)}`,',
    '    hasComparison: true,',
    '  };',
    '}',
    '',
    'function absoluteHistoryHour(sample: CityHistorySample): number {',
    '  return (sample.day - 1) * 24 + sample.hour;',
    '}',
    '',
    'function emptyHistoryReference(): CityHistorySample {',
    '  return {',
    "    key: 'empty',",
    '    day: 1,',
    '    hour: 0,',
    "    timeLabel: '00:00',",
    "    dayPeriod: 'morning',",
    '    population: 0,',
    '    activeCars: 0,',
    '    activeBuses: 0,',
    '    waitingPassengers: 0,',
    '    completedTrips: 0,',
    '    failedTrips: 0,',
    '    publicTripsCompleted: 0,',
    '    carTripsAvoided: 0,',
    '    metroTripsCompleted: 0,',
    '    metroCarsAvoided: 0,',
    '    metroPassengers: 0,',
    '    metroPassengersWaiting: 0,',
    '    metroStations: 0,',
    '    metroLines: 0,',
    '    metroTrains: 0,',
    '    averageCongestion: 0,',
    '    satisfaction: 0,',
    '    averageTravelTime: 0,',
    '    cityLevel: 1,',
    '    buildingTypes: { house: 0, shop: 0, office: 0 },',
    '    buildingLevels: { 1: 0, 2: 0, 3: 0 },',
    '  };',
    '}',
  ]);

  content = replaceOnce(content, marker, helpers, 'periodLabel');
}

if (!content.includes('const comparison = getMetricComparison(samples);')) {
  const oldDeclarations = block([
    '  const latest = samples[samples.length - 1];',
    '  const initial = samples[0];',
    '  const content = useMemo(() => renderTab(activeTab, samples, world), [activeTab, samples, world]);',
  ]);
  const newDeclarations = block([
    '  const latest = samples[samples.length - 1];',
    '  const initial = samples[0];',
    '  const comparison = getMetricComparison(samples);',
    '  const content = useMemo(() => renderTab(activeTab, samples, world), [activeTab, samples, world]);',
  ]);
  content = replaceOnce(content, oldDeclarations, newDeclarations, 'declarações do AnalyticsPanel');
}

const oldHeaderParagraph = block([
  '            <p>',
  "              Desde Dia {initial?.day ?? 1} · {initial?.timeLabel ?? '06:00'} até Dia {latest?.day ?? 1} · {latest?.timeLabel ?? '06:00'}",
  '            </p>',
]);
const newHeaderParagraph = block([
  '            <p>',
  "              Histórico: Dia {initial?.day ?? 1} · {initial?.timeLabel ?? '06:00'} até Dia {latest?.day ?? 1} · {latest?.timeLabel ?? '06:00'} · Cards: {comparison.description}",
  '            </p>',
]);
if (content.includes(oldHeaderParagraph)) {
  content = content.replace(oldHeaderParagraph, newHeaderParagraph);
}

content = content.replace('ChartCard title="População desde o dia 1"', 'ChartCard title="População no período histórico"');

const metricGridStart = content.indexOf('function MetricGrid({ samples, metrics }');
const metricGridEnd = content.indexOf('\ntype Series =', metricGridStart);
if (metricGridStart === -1 || metricGridEnd === -1) {
  fail('Função MetricGrid não encontrada no formato esperado.');
}

const newMetricGrid = block([
  'function MetricGrid({ samples, metrics }: { samples: CityHistorySample[]; metrics: Array<{ label: string; value: number | string; initial: number; currentNumeric?: number }> }) {',
  '  const comparison = getMetricComparison(samples);',
  '  return (',
  '    <div className="analytics-metrics">',
  '      {metrics.map((metric) => {',
  "        const numeric = metric.currentNumeric ?? (typeof metric.value === 'number' ? metric.value : metric.initial);",
  '        const reference = referenceValueForMetric(metric.label, comparison.referenceSample, metric.initial);',
  '        const delta = numeric - reference;',
  '        return (',
  '          <article className="analytics-metric" key={metric.label}>',
  '            <span>{metric.label}</span>',
  '            <strong>{metric.value}</strong>',
  "            <small className={delta > 0 ? 'good' : delta < 0 ? 'bad' : ''}>",
  '              {comparison.hasComparison ? `${formatDelta(delta)} ${comparison.label}` : comparison.label}',
  '            </small>',
  '          </article>',
  '        );',
  '      })}',
  '    </div>',
  '  );',
  '}',
  '',
  'function referenceValueForMetric(label: string, sample: CityHistorySample, fallback: number): number {',
  '  switch (label) {',
  "    case 'População':",
  '      return sample.population;',
  "    case 'Satisfação':",
  '      return sample.satisfaction;',
  "    case 'Nível da cidade':",
  '      return sample.cityLevel;',
  "    case 'Carros ativos':",
  '      return sample.activeCars;',
  "    case 'Congestionamento':",
  '      return sample.averageCongestion;',
  "    case 'Tempo médio':",
  "    case 'Tempo medio':",
  '      return sample.averageTravelTime;',
  "    case 'Ônibus ativos':",
  '      return sample.activeBuses;',
  "    case 'Passageiros esperando':",
  '      return sample.waitingPassengers;',
  "    case 'Carros evitados':",
  '      return sample.carTripsAvoided;',
  "    case 'Viagens de metrô':",
  '      return sample.metroTripsCompleted ?? 0;',
  "    case 'Carros evitados pelo metrô':",
  '      return sample.metroCarsAvoided ?? 0;',
  "    case 'Construções':",
  '      return sample.buildingTypes.house + sample.buildingTypes.shop + sample.buildingTypes.office;',
  "    case 'Casas':",
  '      return sample.buildingTypes.house;',
  "    case 'Empregos/serviços':",
  '      return sample.buildingTypes.shop + sample.buildingTypes.office;',
  "    case 'Concluídas':",
  '      return sample.completedTrips;',
  "    case 'Falhadas':",
  '      return sample.failedTrips;',
  "    case 'Por ônibus':",
  '      return sample.publicTripsCompleted;',
  '    default:',
  '      return fallback;',
  '  }',
  '}',
]);

content = `${content.slice(0, metricGridStart)}${newMetricGrid}${content.slice(metricGridEnd + 1)}`;

fs.writeFileSync(target, content, 'utf8');
console.log('Melhoria aplicada em src/components/AnalyticsPanel.tsx');
console.log('Backups criados com sufixo', backupSuffix);
