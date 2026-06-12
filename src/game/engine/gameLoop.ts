export type GameLoopCallback = (deltaSeconds: number) => void;

export class GameLoop {
  private last = 0;
  private raf = 0;
  private running = false;

  constructor(private readonly callback: GameLoopCallback) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = (now: number) => {
      if (!this.running) return;
      const delta = (now - this.last) / 1000;
      this.last = now;
      this.callback(delta);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }
}
