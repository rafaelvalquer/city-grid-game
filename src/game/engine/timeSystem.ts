import { GAME_CONFIG } from '../config/gameConfig';

export type DayPeriod = 'morning' | 'noon' | 'afternoon' | 'evening' | 'night';

export class TimeSystem {
  private minutes = 6 * 60;
  private day = 1;

  update(deltaSeconds: number): void {
    const nextMinutes = this.minutes + deltaSeconds * GAME_CONFIG.cityMinutePerRealSecond;
    const elapsedDays = Math.floor(nextMinutes / (24 * 60));
    if (elapsedDays > 0) this.day += elapsedDays;
    this.minutes = nextMinutes % (24 * 60);
  }

  getHour(): number {
    return Math.floor(this.minutes / 60);
  }

  getPeriod(): DayPeriod {
    const h = this.getHour();
    if (h >= 6 && h < 10) return 'morning';
    if (h >= 11 && h < 14) return 'noon';
    if (h >= 14 && h < 17) return 'afternoon';
    if (h >= 17 && h < 21) return 'evening';
    return 'night';
  }

  getDay(): number {
    return this.day;
  }

  getLabel(): string {
    const h = Math.floor(this.minutes / 60);
    const m = Math.floor(this.minutes % 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  getTripMultiplier(): number {
    switch (this.getPeriod()) {
      case 'morning': return 1.65;
      case 'noon': return 1.25;
      case 'afternoon': return 0.9;
      case 'evening': return 1.8;
      case 'night': return 0.35;
    }
  }
}
