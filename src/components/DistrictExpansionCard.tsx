import { CheckCircle2, CircleDashed, Map, ShoppingCart } from 'lucide-react';
import type { GameWorld } from '../game/engine/simulation';
import { DISTRICT_EXPANSION_CONFIG } from '../game/config/districtConfig';
import { useGameStore } from '../store/gameStore';

export function DistrictExpansionCard({ world }: { world: GameWorld }) {
  const stats = useGameStore((s) => s.stats);
  const setStats = useGameStore((s) => s.setStats);
  const setSelected = useGameStore((s) => s.setSelected);
  const setActionFeedback = useGameStore((s) => s.setActionFeedback);
  const purchased = world.isEastDistrictPurchased();
  const availability = world.canPurchaseEastDistrict();
  const requirements = availability.requirements;

  const handlePurchase = () => {
    const result = world.purchaseEastDistrict();
    setStats(world.getSnapshot());
    setSelected(world.selected);
    setActionFeedback(result.success
      ? 'Bairro Leste comprado. A área à direita foi liberada para construção.'
      : result.reason ?? 'Não foi possível comprar o bairro.');
  };

  return (
    <div className={'detail-card district-expansion-card ' + (purchased ? 'purchased' : availability.canPurchase ? 'available' : 'locked')}>
      <h3><Map size={15} /> Expansão urbana</h3>
      {purchased ? (
        <>
          <p><span>Status</span><strong className="good">Bairro Leste comprado</strong></p>
          <p><span>Bairros</span><strong>{stats.districtsOwned}</strong></p>
          <p><span>Área liberada</span><strong>{stats.cityAreaTiles} tiles</strong></p>
          <p><span>Carros máximos</span><strong>{stats.activeCars}/{stats.maxCars}</strong></p>
          <p><span>Ônibus máximos</span><strong>{stats.activeBuses}/{stats.maxBuses}</strong></p>
          <p className="muted">Construa vias, ônibus e metrô para conectar o novo bairro ao Centro.</p>
        </>
      ) : (
        <>
          <p><span>Novo bairro</span><strong>{DISTRICT_EXPANSION_CONFIG.eastDistrictName}</strong></p>
          <p><span>Custo</span><strong>$ {DISTRICT_EXPANSION_CONFIG.cost.toLocaleString('pt-BR')}</strong></p>
          <div className="district-requirements">
            {requirements.map((requirement) => (
              <span key={requirement.label} className={requirement.met ? 'met' : 'missing'}>
                {requirement.met ? <CheckCircle2 size={13} /> : <CircleDashed size={13} />}
                {requirement.label}
              </span>
            ))}
          </div>
          <div className="district-benefits">
            <span>+100% área construível</span>
            <span>+100% capacidade de carros</span>
            <span>+100% capacidade de ônibus</span>
          </div>
          <button className="district-purchase-button" type="button" disabled={!availability.canPurchase} onClick={handlePurchase}>
            <ShoppingCart size={14} /> Comprar Bairro Leste
          </button>
          {!availability.canPurchase && availability.reason && <p className="muted">{availability.reason}</p>}
        </>
      )}
    </div>
  );
}
