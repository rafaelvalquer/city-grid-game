import { CheckCircle2, CircleDashed, Flag } from 'lucide-react';
import type { CampaignObjectiveRequirementSnapshot } from '../game/campaign/campaignTypes';
import { useGameStore } from '../store/gameStore';

export function CampaignMissionPanel() {
  const mission = useGameStore((state) => state.campaignMission);
  if (!mission) return null;
  const stabilityRatio = mission.stabilitySeconds / mission.holdSeconds;
  return (
    <section className="campaign-mission-panel" aria-label="Objetivos da campanha">
      <header><Flag size={15} /> Missão</header>
      {mission.objectives.map((objective) => (
        <MissionRow
          key={objective.id}
          met={objective.met}
          label={objective.label}
          value={objective.requirements.map(formatRequirement).join(' · ')}
        />
      ))}
      <div className="campaign-stability">
        <span>Estabilidade</span><strong>{Math.floor(mission.stabilitySeconds)}/{mission.holdSeconds}s</strong>
        <i><b style={{ width: `${Math.min(100, stabilityRatio * 100)}%` }} /></i>
      </div>
    </section>
  );
}

function MissionRow({ met, label, value }: { met: boolean; label: string; value: string }) {
  return <div className={met ? 'met' : ''}>{met ? <CheckCircle2 size={14} /> : <CircleDashed size={14} />}<span>{label}</span><strong>{value}</strong></div>;
}

function formatRequirement(requirement: CampaignObjectiveRequirementSnapshot): string {
  const suffix = requirement.unit === '%' ? '%' : requirement.unit ? ` ${requirement.unit}` : '';
  const operator = requirement.comparator === 'max' ? '≤' : '';
  return `${requirement.current}${suffix}/${operator}${requirement.target}${suffix}`;
}
