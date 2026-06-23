import {
  ArrowLeft,
  Bike,
  BusFront,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Globe2,
  LockKeyhole,
  Plane,
  Play,
  TrainFront,
  Trees,
  Trophy,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
} from 'react';
import { CAMPAIGN_CITIES } from '../game/campaign/campaignMaps';
import { isCampaignLevel2Unlocked, isCampaignLevel3Unlocked, loadCampaignProgress } from '../game/campaign/campaignProgress';
import type { CampaignCityDefinition, CampaignObjectiveRequirement } from '../game/campaign/campaignTypes';
import type { CampaignCityId } from '../game/config/gameSetup';
import {
  getCampaignCardOffset,
  getCampaignSwipeDirection,
  getCampaignWheelDirection,
  getInitialCampaignIndex,
  wrapCampaignIndex,
} from '../game/campaign/campaignCarousel';

const TRANSITION_MS = 420;

export function CampaignSelectionScreen({
  onBack,
  onSelect,
  initialLevel = 1,
}: {
  onBack: () => void;
  onSelect: (cityId: CampaignCityId) => void;
  initialLevel?: 1 | 2 | 3;
}) {
  const progress = useMemo(() => loadCampaignProgress(), []);
  const level2Unlocked = isCampaignLevel2Unlocked(progress);
  const level3Unlocked = isCampaignLevel3Unlocked(progress);
  const normalizedInitialLevel = initialLevel === 3 && level3Unlocked ? 3 : initialLevel === 2 && level2Unlocked ? 2 : 1;
  const [selectedLevel, setSelectedLevel] = useState<1 | 2 | 3>(normalizedInitialLevel);
  const cities = useMemo(() => CAMPAIGN_CITIES.filter((city) => city.campaignLevel === selectedLevel), [selectedLevel]);
  const [selectedCityIndex, setSelectedCityIndex] = useState(() => getInitialCampaignIndex(
    CAMPAIGN_CITIES.filter((city) => city.campaignLevel === normalizedInitialLevel).map((city) => city.id),
    progress,
  ));
  const [transitioning, setTransitioning] = useState(false);
  const pointerStartX = useRef<number | null>(null);
  const transitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedCardRef = useRef<HTMLElement | null>(null);
  const selectedCity = cities[selectedCityIndex] ?? cities[0];
  const completedCount = CAMPAIGN_CITIES.filter((city) => progress[city.id]).length;
  const chapterCompletedCount = cities.filter((city) => progress[city.id]).length;
  const chapterLocked = selectedLevel === 2 ? !level2Unlocked : selectedLevel === 3 ? !level3Unlocked : false;

  const selectIndex = (nextIndex: number) => {
    if (transitioning || cities.length === 0) return;
    const wrapped = wrapCampaignIndex(nextIndex, cities.length);
    if (wrapped === selectedCityIndex) return;
    setSelectedCityIndex(wrapped);
    setTransitioning(true);
    if (transitionTimer.current) clearTimeout(transitionTimer.current);
    transitionTimer.current = setTimeout(() => setTransitioning(false), TRANSITION_MS);
  };

  const selectLevel = (level: 1 | 2 | 3) => {
    if (level === selectedLevel) return;
    const nextCities = CAMPAIGN_CITIES.filter((city) => city.campaignLevel === level);
    setSelectedLevel(level);
    setSelectedCityIndex(getInitialCampaignIndex(nextCities.map((city) => city.id), progress));
    setTransitioning(false);
  };

  const move = (direction: -1 | 1) => selectIndex(selectedCityIndex + direction);

  useEffect(() => () => {
    if (transitionTimer.current) clearTimeout(transitionTimer.current);
  }, []);

  useEffect(() => {
    selectedCardRef.current?.focus({ preventScroll: true });
  }, [selectedCityIndex, selectedLevel]);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      move(-1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      move(1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      selectIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      selectIndex(cities.length - 1);
    }
  };

  const handleWheel = (event: ReactWheelEvent<HTMLElement>) => {
    const direction = getCampaignWheelDirection(event.deltaX, event.deltaY);
    if (!direction) return;
    event.preventDefault();
    move(direction);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as Element).closest('button')) {
      pointerStartX.current = null;
      return;
    }
    pointerStartX.current = event.clientX;
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    if ((event.target as Element).closest('button')) {
      pointerStartX.current = null;
      return;
    }
    if (pointerStartX.current === null) return;
    const direction = getCampaignSwipeDirection(event.clientX - pointerStartX.current);
    pointerStartX.current = null;
    if (direction) move(direction);
  };

  if (!selectedCity) return null;

  return (
    <main
      className={`campaign-select-screen campaign-theme-${selectedCity.id} ${chapterLocked ? 'is-locked-chapter' : ''}`}
      style={{ '--city-accent': selectedCity.accent } as CSSProperties}
    >
      <div className="campaign-atmosphere" aria-hidden="true">
        <i className="campaign-atmosphere-water" />
        <i className="campaign-atmosphere-relief" />
        <i className="campaign-atmosphere-grid" />
        <i className="campaign-atmosphere-glow" />
      </div>

      <header className="campaign-select-header">
        <button className="menu-secondary-action compact" onClick={onBack}><ArrowLeft size={17} /> Menu</button>
        <div>
          <p className="menu-kicker"><Globe2 size={15} /> Campanha mundial</p>
          <h1>Escolha uma cidade</h1>
          <p>Supere a geografia local e mantenha todos os objetivos estáveis.</p>
        </div>
        <div className="campaign-global-progress"><Trophy size={16} /><strong>{completedCount}</strong><span>de {CAMPAIGN_CITIES.length} concluídas</span></div>
      </header>

      <nav className="campaign-level-tabs" aria-label="Níveis da campanha">
        <button className={selectedLevel === 1 ? 'active' : ''} onClick={() => selectLevel(1)}>
          <span>Nível 1</span><small>{CAMPAIGN_CITIES.filter((city) => city.campaignLevel === 1 && progress[city.id]).length}/4 concluídas</small>
        </button>
        <button className={selectedLevel === 2 ? 'active' : ''} onClick={() => selectLevel(2)}>
          {!level2Unlocked && <LockKeyhole size={15} />}
          <span>Nível 2</span><small>{level2Unlocked ? `${CAMPAIGN_CITIES.filter((city) => city.campaignLevel === 2 && progress[city.id]).length}/4 concluídas` : 'Conclua o Nível 1'}</small>
        </button>
        <button className={selectedLevel === 3 ? 'active' : ''} onClick={() => selectLevel(3)}>
          {!level3Unlocked && <LockKeyhole size={15} />}
          <span>Nível 3</span><small>{level3Unlocked ? `${CAMPAIGN_CITIES.filter((city) => city.campaignLevel === 3 && progress[city.id]).length}/4 concluídas` : 'Conclua o Nível 2'}</small>
        </button>
      </nav>

      <section
        className={`campaign-carousel ${transitioning ? 'is-transitioning' : ''}`}
        role="region"
        aria-roledescription="carrossel"
        aria-label={`Cidades do Nível ${selectedLevel}`}
        aria-live="polite"
        onKeyDown={handleKeyDown}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => { pointerStartX.current = null; }}
      >
        <button className="campaign-carousel-arrow previous" aria-label="Cidade anterior" onClick={() => move(-1)} disabled={transitioning}>
          <ChevronLeft size={28} />
        </button>

        <div className="campaign-carousel-stage" role="list">
          {cities.map((city, cityIndex) => {
            const completed = progress[city.id];
            const offset = getCampaignCardOffset(cityIndex, selectedCityIndex, cities.length);
            const active = offset === 0;
            return (
              <article
                className={`campaign-city-card city-${city.id} ${city.campaignLevel === 3 ? 'is-megacity' : ''} ${active ? 'is-active' : 'is-side'} ${offset < 0 ? 'is-left' : offset > 0 ? 'is-right' : ''} ${chapterLocked ? 'is-locked' : ''}`}
                key={city.id}
                role="listitem"
                aria-current={active ? 'true' : undefined}
                aria-label={`${city.name}, ${city.country}${completed ? ', missão concluída' : ''}${chapterLocked ? ', bloqueada' : ''}`}
                tabIndex={active ? 0 : -1}
                ref={active ? selectedCardRef : undefined}
                onClick={() => !active && selectIndex(cityIndex)}
                style={{
                  '--card-offset': offset,
                  '--card-distance': Math.abs(offset),
                  '--card-accent': city.accent,
                } as CSSProperties}
              >
                <div className="campaign-city-preview" aria-hidden="true">
                  <span className="preview-water" /><span className="preview-relief" />
                  <span className="preview-grid" /><span className="preview-light" />
                </div>
                <div className="campaign-city-content">
                  <div className="campaign-city-title">
                    <div><h2>{city.name}</h2><span>{city.country}</span></div>
                    {completed && <CheckCircle2 className="campaign-complete-icon" size={22} />}
                    {chapterLocked && <LockKeyhole className="campaign-lock-icon" size={22} />}
                  </div>
                  <p>{city.description}</p>
                  <span className="campaign-biome"><Trees size={14} /> {city.biome}</span>
                  {city.campaignLevel === 3 && <span className="campaign-megacity-badge">Megacidade</span>}
                  <FeaturedObjective city={city} />
                  <div className="campaign-objectives">
                    {city.mission.objectives.map((objective) => (
                      <span key={objective.id}>{objective.label} <strong>{objective.requirements.map(formatTarget).join(' · ')}</strong></span>
                    ))}
                  </div>
                  {completed && <small>Melhor conclusão: {formatDuration(completed.elapsedSeconds)}</small>}
                </div>
              </article>
            );
          })}
        </div>

        <button className="campaign-carousel-arrow next" aria-label="Próxima cidade" onClick={() => move(1)} disabled={transitioning}>
          <ChevronRight size={28} />
        </button>
      </section>

      <section className="campaign-carousel-actions" aria-label={`Cidade selecionada: ${selectedCity.name}`}>
        <div className="campaign-chapter-progress">Nível {selectedLevel}: {chapterCompletedCount}/4 concluídas</div>
        <div className="campaign-carousel-dots" role="tablist" aria-label="Selecionar cidade">
          {cities.map((city, index) => (
            <button
              key={city.id}
              role="tab"
              aria-selected={index === selectedCityIndex}
              aria-label={`Selecionar ${city.name}`}
              className={index === selectedCityIndex ? 'active' : ''}
              onClick={() => selectIndex(index)}
            />
          ))}
        </div>
        {chapterLocked ? (
          <div className="campaign-level-lock-message"><LockKeyhole size={18} /> Conclua 4/4 cidades do Nível {selectedLevel - 1} para desbloquear estas missões.</div>
        ) : (
          <button className="menu-primary-action campaign-start-button" onClick={() => onSelect(selectedCity.id)} disabled={transitioning}>
            <Play size={19} /> {progress[selectedCity.id] ? 'Jogar novamente' : 'Iniciar missão'} — {selectedCity.name}
          </button>
        )}
        <p>Use ← →, a roda do mouse ou arraste para navegar.</p>
      </section>
    </main>
  );
}

function FeaturedObjective({ city }: { city: CampaignCityDefinition }) {
  if (!city.featuredObjectives?.length) return null;
  const labels = { bike: 'Mobilidade ciclável', bus: 'Corredor BRT', metro: 'Rede de metrô', air: 'Hub aéreo' };
  const icons = { bike: Bike, bus: BusFront, metro: TrainFront, air: Plane };
  return <div className="campaign-featured-objectives">{city.featuredObjectives.map((objective) => {
    const Icon = icons[objective];
    return <span className="campaign-featured-objective" key={objective}><Icon size={15} /> {labels[objective]}</span>;
  })}</div>;
}

function formatTarget(requirement: CampaignObjectiveRequirement): string {
  const suffix = requirement.unit === '%' ? '%' : requirement.unit ? ` ${requirement.unit}` : '';
  return `${requirement.comparator === 'max' ? '≤ ' : ''}${requirement.target}${suffix}`;
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds % 60)}s`;
}
