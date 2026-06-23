import { Award, Map } from 'lucide-react';
import type { CampaignMissionSnapshot } from '../game/campaign/campaignTypes';
import { getCampaignCity } from '../game/campaign/campaignMaps';

export function CampaignVictoryModal({
  mission,
  onBack,
  unlockedLevel,
}: {
  mission: CampaignMissionSnapshot;
  onBack: () => void;
  unlockedLevel?: 2 | 3 | null;
}) {
  const city = getCampaignCity(mission.cityId);
  return (
    <div className="campaign-victory-backdrop" role="presentation">
      <section className="campaign-victory-modal" role="dialog" aria-modal="true" aria-labelledby="campaign-victory-title">
        <Award size={42} />
        <p className="menu-kicker">Missão concluída</p>
        <h2 id="campaign-victory-title">Parabéns por transformar {city?.name ?? 'a cidade'}!</h2>
        <p>Os {mission.objectives.length} objetivos permaneceram estáveis por {mission.holdSeconds} segundos simulados.</p>
        {unlockedLevel && <div className="campaign-level-unlocked">Nível {unlockedLevel} desbloqueado — novas cidades disponíveis!</div>}
        <div className="campaign-result-grid">
          <span>População<strong>{mission.population}</strong></span>
          <span>Satisfação<strong>{mission.satisfaction}%</strong></span>
          <span>Trânsito<strong>{mission.traffic}%</strong></span>
          <span>Conclusão<strong>Dia {mission.day}, {mission.timeLabel}</strong></span>
        </div>
        <button className="menu-primary-action" onClick={onBack}><Map size={17} /> Voltar para cidades</button>
      </section>
    </div>
  );
}
