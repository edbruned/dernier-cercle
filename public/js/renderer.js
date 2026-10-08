// Dessin de la partie dans un <canvas> 2D. La caméra suit le joueur observé.
import { MAP, PLAYER, WEAPONS } from '/shared/config.js';

const VISIBLE_WIDTH = 1600; // largeur de carte visible (en pixels du jeu), quelle que soit la taille d'écran
const VISIBLE_HEIGHT = 1000;
const SNIPER_ZOOM = 0.72; // avec le sniper en main, on voit plus loin

export class Renderer {
  constructor(canvas, minimap) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.minimap = minimap;
    this.mctx = minimap.getContext('2d');
    this.map = null;
    this.zoom = null;
    this.floaters = []; // chiffres de dégâts qui flottent au-dessus des cibles touchées
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(window.innerWidth * this.dpr);
    this.canvas.height = Math.round(window.innerHeight * this.dpr);
  }

  setMap(map) {
    this.map = map;
    this.zoom = null;
    this.floaters = [];
    this.minimapBackground = this.drawMinimapBackground();
  }

  addFloater(x, y, text, color) {
    this.floaters.push({ x, y, text, color, born: performance.now() });
  }

  // view : { players, bullets, loot, zone, camera, meId, scoped }
  draw(view) {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    const targetZoom = Math.min(w / VISIBLE_WIDTH, h / VISIBLE_HEIGHT) * (view.scoped ? SNIPER_ZOOM : 1);
    this.zoom = this.zoom === null ? targetZoom : this.zoom + (targetZoom - this.zoom) * 0.12;
    const s = this.zoom;
    const cam = view.camera;

    // Zone visible, en coordonnées de la carte (pour ne dessiner que ce qui est à l'écran)
    const bounds = {
      left: cam.x - w / 2 / s, right: cam.x + w / 2 / s,
      top: cam.y - h / 2 / s, bottom: cam.y + h / 2 / s,
    };
    const visible = (x, y, margin) => x > bounds.left - margin && x < bounds.right + margin
      && y > bounds.top - margin && y < bounds.bottom + margin;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#18240f';
    ctx.fillRect(0, 0, w, h);
    // Toutes les coordonnées suivantes sont celles de la carte : la transformation fait le reste
    ctx.setTransform(s, 0, 0, s, w / 2 - cam.x * s, h / 2 - cam.y * s);

    this.drawGround(bounds);
    for (const item of view.loot) if (visible(item.x, item.y, 40)) this.drawLoot(item);
    for (const o of this.map.obstacles) if (visible(o.x, o.y, 340)) this.drawObstacle(o);
    for (const b of view.bullets) if (visible(b.x, b.y, 100)) this.drawBullet(b);
    for (const p of view.players) {
      if (p.alive && visible(p.x, p.y, 80)) this.drawPlayer(p, p.id === view.meId);
    }
    this.drawZone(view.zone, bounds);
    this.drawFloaters();
    this.drawMinimap(view);
  }

  drawGround(b) {
    const { ctx } = this;
    ctx.fillStyle = '#6f9a52';
    ctx.fillRect(0, 0, MAP.SIZE, MAP.SIZE);
    // Quadrillage : sans repère, on ne voit pas qu'on avance
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.07)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    const step = 120;
    const x0 = Math.max(0, Math.floor(b.left / step) * step);
    const y0 = Math.max(0, Math.floor(b.top / step) * step);
    for (let x = x0; x <= Math.min(MAP.SIZE, b.right); x += step) { ctx.moveTo(x, Math.max(0, b.top)); ctx.lineTo(x, Math.min(MAP.SIZE, b.bottom)); }
    for (let y = y0; y <= Math.min(MAP.SIZE, b.bottom); y += step) { ctx.moveTo(Math.max(0, b.left), y); ctx.lineTo(Math.min(MAP.SIZE, b.right), y); }
    ctx.stroke();
    ctx.strokeStyle = '#2b3d1e';
    ctx.lineWidth = 8;
    ctx.strokeRect(0, 0, MAP.SIZE, MAP.SIZE);
  }

  drawObstacle(o) {
    const { ctx } = this;
    ctx.lineWidth = 4;
    if (o.type === 'crate') {
      ctx.fillStyle = '#a0703f';
      ctx.strokeStyle = '#6b4423';
      ctx.fillRect(o.x, o.y, o.w, o.h);
      ctx.strokeRect(o.x, o.y, o.w, o.h);
      ctx.strokeStyle = 'rgba(80, 48, 22, 0.6)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(o.x + 8, o.y + 8); ctx.lineTo(o.x + o.w - 8, o.y + o.h - 8);
      ctx.moveTo(o.x + o.w - 8, o.y + 8); ctx.lineTo(o.x + 8, o.y + o.h - 8);
      ctx.stroke();
    } else if (o.type === 'wall') {
      ctx.fillStyle = '#7b8794';
      ctx.strokeStyle = '#4a5561';
      ctx.fillRect(o.x, o.y, o.w, o.h);
      ctx.strokeRect(o.x, o.y, o.w, o.h);
    } else if (o.type === 'rock') {
      this.circle(o.x, o.y, o.r, '#9aa5b1', '#5f6b78');
      this.circle(o.x - o.r * 0.3, o.y - o.r * 0.3, o.r * 0.35, 'rgba(255, 255, 255, 0.14)');
    } else {
      ctx.lineWidth = 5;
      this.circle(o.x, o.y, o.r, '#2f7a3d', '#1d5228');
      this.circle(o.x, o.y, o.r * 0.55, '#3a8f4a');
    }
  }

  drawLoot(item) {
    const { ctx } = this;
    if (item.kind === 'plate') {
      ctx.save();
      ctx.shadowColor = '#4dabf7';
      ctx.shadowBlur = 14;
      ctx.fillStyle = '#1c7ed6';
      ctx.strokeStyle = '#a5d8ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(item.x - 11, item.y - 14, 22, 28, 6);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      return;
    }
    // Socle carré clair : on ne le confond pas avec un joueur (rond)
    const def = WEAPONS[item.weapon];
    ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(item.x - 28, item.y - 16, 56, 32, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = def.color;
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 2;
    ctx.fillRect(item.x - def.length / 2, item.y - 4, def.length, 8);
    ctx.strokeRect(item.x - def.length / 2, item.y - 4, def.length, 8);
    this.label(def.name, item.x, item.y + 28, 12, '#fff');
  }

  drawBullet(b) {
    const { ctx } = this;
    const len = b.weapon === 'sniper' ? 80 : 26;
    ctx.strokeStyle = b.weapon === 'sniper' ? '#f3d9fa' : '#fff3bf';
    ctx.lineWidth = b.weapon === 'sniper' ? 4 : 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(b.x - Math.cos(b.angle) * len, b.y - Math.sin(b.angle) * len);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  drawPlayer(p, isMe) {
    const { ctx } = this;
    const R = PLAYER.RADIUS;
    ctx.save();
    if (p.invulnerable) ctx.globalAlpha = 0.45 + 0.25 * Math.sin(performance.now() / 80);

    // Arme (ou poings), dans le repère tourné vers la direction de visée
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    const weapon = p.slots[p.current];
    if (weapon) {
      const def = WEAPONS[weapon];
      ctx.fillStyle = '#1b1b1b';
      ctx.fillRect(R - 8, -5, def.length + 4, 10);
      ctx.fillStyle = def.color;
      ctx.fillRect(R - 6, -3, def.length, 6);
      this.circle(R - 2, 6, 6, p.color, 'rgba(0, 0, 0, 0.55)');
    } else {
      ctx.lineWidth = 2.5;
      this.circle(R * 0.8, -R * 0.65, 7, p.color, 'rgba(0, 0, 0, 0.55)');
      this.circle(R * 0.8, R * 0.65, 7, p.color, 'rgba(0, 0, 0, 0.55)');
    }
    ctx.restore();

    ctx.lineWidth = 3;
    this.circle(p.x, p.y, R, p.color, isMe ? '#fff' : 'rgba(0, 0, 0, 0.55)');
    ctx.restore();

    if (isMe) return;
    // Pseudo et barres de vie au-dessus des autres joueurs
    this.label(p.name, p.x, p.y - R - 20, 13, p.bot ? '#dee2e6' : '#fff');
    const barW = 44;
    const x = p.x - barW / 2;
    const y = p.y - R - 12;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(x - 1, y - 1, barW + 2, 9);
    ctx.fillStyle = '#4dabf7';
    ctx.fillRect(x, y, (barW * p.shield) / PLAYER.MAX_SHIELD, 3);
    ctx.fillStyle = '#f1f3f5';
    ctx.fillRect(x, y + 3, (barW * p.hp) / PLAYER.MAX_HEALTH, 4);
  }

  // Tout ce qui est hors du cercle est teinté en violet
  drawZone(zone, b) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.rect(b.left - 100, b.top - 100, b.right - b.left + 200, b.bottom - b.top + 200);
    ctx.arc(zone.x, zone.y, Math.max(zone.r, 0.1), 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(120, 50, 200, 0.32)';
    ctx.fill('evenodd');

    ctx.lineWidth = 6;
    ctx.strokeStyle = '#b197fc';
    ctx.beginPath();
    ctx.arc(zone.x, zone.y, Math.max(zone.r, 0.1), 0, Math.PI * 2);
    ctx.stroke();

    if (zone.nextR < zone.r - 1) {
      ctx.setLineDash([26, 18]);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.beginPath();
      ctx.arc(zone.nextX, zone.nextY, zone.nextR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  drawFloaters() {
    const now = performance.now();
    this.floaters = this.floaters.filter((f) => now - f.born < 900);
    for (const f of this.floaters) {
      const k = (now - f.born) / 900;
      this.ctx.globalAlpha = 1 - k;
      this.label(String(f.text), f.x, f.y - 30 - k * 40, 18, f.color);
    }
    this.ctx.globalAlpha = 1;
  }

  // ---------- Minicarte ----------

  drawMinimapBackground() {
    const size = this.minimap.width;
    const off = document.createElement('canvas');
    off.width = size;
    off.height = size;
    const c = off.getContext('2d');
    const k = size / MAP.SIZE;
    c.fillStyle = '#4f7a3a';
    c.fillRect(0, 0, size, size);
    c.fillStyle = 'rgba(0, 0, 0, 0.35)';
    for (const o of this.map.obstacles) {
      if (o.shape === 'circle') {
        c.beginPath();
        c.arc(o.x * k, o.y * k, Math.max(1, o.r * k), 0, Math.PI * 2);
        c.fill();
      } else {
        c.fillRect(o.x * k, o.y * k, Math.max(1, o.w * k), Math.max(1, o.h * k));
      }
    }
    return off;
  }

  drawMinimap(view) {
    const c = this.mctx;
    const size = this.minimap.width;
    const k = size / MAP.SIZE;
    const z = view.zone;
    c.drawImage(this.minimapBackground, 0, 0);

    c.beginPath();
    c.rect(0, 0, size, size);
    c.arc(z.x * k, z.y * k, Math.max(z.r * k, 0.1), 0, Math.PI * 2);
    c.fillStyle = 'rgba(120, 50, 200, 0.45)';
    c.fill('evenodd');
    c.lineWidth = 1.5;
    c.strokeStyle = '#d0bfff';
    c.beginPath();
    c.arc(z.x * k, z.y * k, Math.max(z.r * k, 0.1), 0, Math.PI * 2);
    c.stroke();
    if (z.nextR < z.r - 1) {
      c.strokeStyle = '#fff';
      c.beginPath();
      c.arc(z.nextX * k, z.nextY * k, z.nextR * k, 0, Math.PI * 2);
      c.stroke();
    }

    // Position du joueur observé (les autres ne sont pas affichés : ce serait de la triche)
    const cam = view.camera;
    c.fillStyle = '#fff';
    c.strokeStyle = '#000';
    c.lineWidth = 1.5;
    c.beginPath();
    c.arc(cam.x * k, cam.y * k, 4, 0, Math.PI * 2);
    c.fill();
    c.stroke();
  }

  // ---------- Utilitaires ----------

  circle(x, y, r, fill, stroke) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
  }

  label(text, x, y, size, color) {
    const { ctx } = this;
    ctx.font = `700 ${size}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }
}
