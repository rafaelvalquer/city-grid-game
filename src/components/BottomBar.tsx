import { useGameStore } from '../store/gameStore';

export function BottomBar() {
  const stats = useGameStore((s) => s.stats);
  return (
    <footer className="bottom-bar">
      <span>Prédios desconectados: {stats.disconnectedBuildings}</span>
      <span>Viagens concluídas: {stats.completedTrips}</span>
      <span>Viagens sem rota: {stats.failedTrips}</span>
      <span>Dica: avenidas são mais caras, mas reduzem congestionamento e atraem rotas mais rápidas.</span>
    </footer>
  );
}
