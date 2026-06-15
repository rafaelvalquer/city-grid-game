import { Container, Graphics, Text } from 'pixi.js';
import type { TrafficCell, Vec2 } from '../../types/city.types';
import { MAP_COLORS, congestionColor } from './visualTheme';

type ParticleKind = 'dust' | 'spark' | 'pulse' | 'smoke';

type Particle = {
  kind: ParticleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  color: number;
  alpha: number;
};

type FloatingText = {
  label: Text;
  x: number;
  y: number;
  vy: number;
  age: number;
  life: number;
};

const MAX_PARTICLES = 360;
const MAX_TEXTS = 24;

export class ParticleSystem {
  private particles: Particle[] = [];
  private texts: FloatingText[] = [];

  constructor(private readonly textLayer: Container) {}

  update(dt: number): void {
    for (const particle of this.particles) {
      particle.age += dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      if (particle.kind === 'smoke') particle.size += dt * 0.32;
      if (particle.kind === 'pulse') particle.size += dt * 2.2;
    }
    this.particles = this.particles.filter((particle) => particle.age < particle.life);

    for (const text of this.texts) {
      text.age += dt;
      text.y += text.vy * dt;
    }
    const aliveTexts = this.texts.filter((text) => text.age < text.life);
    for (const text of this.texts) {
      if (!aliveTexts.includes(text)) {
        this.textLayer.removeChild(text.label);
        text.label.destroy();
      }
    }
    this.texts = aliveTexts;
  }

  draw(graphics: Graphics, tileSize: number): void {
    graphics.clear();
    for (const particle of this.particles) {
      const t = Math.min(1, particle.age / particle.life);
      const alpha = particle.alpha * (1 - t);
      const x = particle.x * tileSize + tileSize / 2;
      const y = particle.y * tileSize + tileSize / 2;

      if (particle.kind === 'spark') {
        graphics.circle(x, y, particle.size * (0.8 + t * 0.4)).fill({ color: particle.color, alpha });
        continue;
      }

      if (particle.kind === 'pulse') {
        graphics.circle(x, y, particle.size * tileSize * 0.32).stroke({ color: particle.color, width: 2, alpha });
        graphics.circle(x, y, particle.size * tileSize * 0.18).fill({ color: particle.color, alpha: alpha * 0.12 });
        continue;
      }

      if (particle.kind === 'smoke') {
        graphics.circle(x, y, particle.size * tileSize * 0.16).fill({ color: particle.color, alpha: alpha * 0.5 });
        continue;
      }

      graphics.circle(x, y, particle.size).fill({ color: particle.color, alpha });
    }

    for (const text of this.texts) {
      const t = Math.min(1, text.age / text.life);
      text.label.position.set(text.x * tileSize + tileSize / 2, text.y * tileSize + tileSize / 2);
      text.label.alpha = 1 - t;
      text.label.scale.set(1 + t * 0.08);
    }
  }

  emitRoadDust(pos: Vec2, count = 8): void {
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.35 + Math.random() * 0.75;
      this.addParticle({
        kind: 'dust',
        x: pos.x + (Math.random() - 0.5) * 0.48,
        y: pos.y + (Math.random() - 0.5) * 0.48,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 0.08,
        age: 0,
        life: 0.42 + Math.random() * 0.28,
        size: 1.4 + Math.random() * 2.2,
        color: 0xd8c4a3,
        alpha: 0.48,
      });
    }
  }

  emitTrafficLightSpark(pos: Vec2): void {
    for (let i = 0; i < 14; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.55 + Math.random() * 1.05;
      this.addParticle({
        kind: 'spark',
        x: pos.x,
        y: pos.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        age: 0,
        life: 0.28 + Math.random() * 0.22,
        size: 1.2 + Math.random() * 1.8,
        color: Math.random() > 0.35 ? MAP_COLORS.streetLamp : MAP_COLORS.lane,
        alpha: 0.85,
      });
    }
  }

  emitConnectionPulse(pos: Vec2): void {
    this.addParticle({
      kind: 'pulse',
      x: pos.x,
      y: pos.y,
      vx: 0,
      vy: 0,
      age: 0,
      life: 0.85,
      size: 0.42,
      color: MAP_COLORS.treeLight,
      alpha: 0.85,
    });
  }

  emitCongestionSmoke(cell: TrafficCell): void {
    const intensity = Math.min(1, Math.max(0.25, (cell.congestion - 1.1) / 1.2));
    for (let i = 0; i < 3; i += 1) {
      this.addParticle({
        kind: 'smoke',
        x: cell.x + (Math.random() - 0.5) * 0.35,
        y: cell.y + (Math.random() - 0.5) * 0.25,
        vx: (Math.random() - 0.5) * 0.15,
        vy: -0.18 - Math.random() * 0.16,
        age: 0,
        life: 1.2 + Math.random() * 0.65,
        size: 0.32 + Math.random() * 0.28,
        color: congestionColor(cell.congestion),
        alpha: 0.18 + intensity * 0.18,
      });
    }
  }

  emitMoneyText(pos: Vec2, amount: number): void {
    if (!Number.isFinite(amount) || Math.round(amount) === 0) return;
    const value = Math.round(amount);
    const label = new Text({
      text: `${value > 0 ? '+' : '-'}$${Math.abs(value)}`,
      style: {
        fontFamily: 'Arial',
        fontSize: 11,
        fontWeight: '700',
        fill: value > 0 ? MAP_COLORS.treeLight : MAP_COLORS.disconnected,
      },
    });
    label.anchor.set(0.5);
    this.textLayer.addChild(label);
    this.texts.push({
      label,
      x: pos.x + (Math.random() - 0.5) * 0.15,
      y: pos.y - 0.05,
      vy: -0.62,
      age: 0,
      life: 1.05,
    });
    if (this.texts.length > MAX_TEXTS) {
      const removed = this.texts.splice(0, this.texts.length - MAX_TEXTS);
      for (const text of removed) {
        this.textLayer.removeChild(text.label);
        text.label.destroy();
      }
    }
  }

  destroy(): void {
    this.particles = [];
    for (const text of this.texts) {
      this.textLayer.removeChild(text.label);
      text.label.destroy();
    }
    this.texts = [];
  }

  private addParticle(particle: Particle): void {
    this.particles.push(particle);
    if (this.particles.length > MAX_PARTICLES) {
      this.particles.splice(0, this.particles.length - MAX_PARTICLES);
    }
  }
}
