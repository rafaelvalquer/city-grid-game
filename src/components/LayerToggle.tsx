import { useGameStore } from '../store/gameStore';

export function LayerToggle() {
  const viewLayer = useGameStore((s) => s.viewLayer);
  const setViewLayer = useGameStore((s) => s.setViewLayer);

  return (
    <div className="layer-toggle" role="group" aria-label="Camada de visualização">
      <button
        type="button"
        className={viewLayer === 'surface' ? 'active' : ''}
        onClick={() => setViewLayer('surface')}
        aria-pressed={viewLayer === 'surface'}
      >
        🌆 Superfície
      </button>
      <button
        type="button"
        className={viewLayer === 'underground' ? 'active' : ''}
        onClick={() => setViewLayer('underground')}
        aria-pressed={viewLayer === 'underground'}
      >
        🚇 Subsolo
      </button>
    </div>
  );
}
