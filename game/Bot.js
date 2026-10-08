// Intelligence artificielle des bots.
// Un bot "réfléchit" 10 fois par seconde pour choisir un objectif, puis agit à chaque tick
// en remplissant les mêmes commandes qu'un joueur humain (déplacement, visée, tir).
// Ordre des priorités : sortir de la zone > combattre > ramasser du matériel > explorer.
import { BOT_LEVELS, PLAYER, WEAPONS } from '../shared/config.js';
import { distance, hasLineOfSight, randomBetween } from './geometry.js';
import { randomFreePosition } from './mapGen.js';

const WEAPON_RANK = { pistol: 1, shotgun: 2, sniper: 2, m16: 3 };
const IDEAL_RANGE = { pistol: 320, m16: 420, shotgun: 170, sniper: 750 };
const THINK_INTERVAL = 0.1;

export class Bot {
  constructor(player, game, difficulty) {
    this.p = player;
    this.game = game;
    this.level = BOT_LEVELS[difficulty];
    this.thinkTimer = Math.random() * THINK_INTERVAL;
    this.mode = 'wander';
    this.goal = null;
    this.enemy = null;
    this.enemySince = 0;
    this.aimOffset = 0;
    this.strafing = false;
    this.strafeDir = 1;
    this.strafeTimer = 0;
    this.stuck = { x: player.x, y: player.y, timer: 0.5 };
    this.detour = null;
  }

  update(dt) {
    if (!this.p.alive) {
      this.p.input.shoot = false;
      this.enemy = null;
      this.goal = null;
      return;
    }
    this.thinkTimer -= dt;
    if (this.thinkTimer <= 0) {
      this.thinkTimer = THINK_INTERVAL;
      this.think();
    }
    this.act(dt);
  }

  // ---------- Décision ----------

  think() {
    const { p, game } = this;
    const zone = game.zone;

    const enemy = this.findEnemy();
    if (enemy !== this.enemy) {
      this.enemy = enemy;
      this.enemySince = game.time; // le temps de réaction démarre quand il repère l'ennemi
    }
    // L'erreur de visée change à chaque réflexion : plus le niveau est bas, plus elle est grande
    this.aimOffset = (Math.random() * 2 - 1) * this.level.aimError;

    const hasWeapon = p.slots.some(Boolean);
    const outsideZone = distance(p.x, p.y, zone.x, zone.y) > zone.r - 30;
    const outsideNext = distance(p.x, p.y, zone.nextX, zone.nextY) > zone.nextR - 30;
    const zoneSoon = outsideNext && (zone.shrinking || zone.timer < 25);

    if (outsideZone) {
      this.setGoal('zone', { x: zone.nextX, y: zone.nextY });
    } else if (enemy && hasWeapon) {
      this.mode = 'fight';
    } else if (zoneSoon) {
      this.setGoal('zone', { x: zone.nextX, y: zone.nextY });
    } else {
      const item = this.findLoot(enemy || !hasWeapon ? 1500 : 900);
      if (item) {
        this.setGoal('loot', item);
      } else if (this.mode !== 'wander' || !this.goal || distance(p.x, p.y, this.goal.x, this.goal.y) < 50) {
        const area = { x: zone.nextX, y: zone.nextY, r: zone.nextR * 0.8 };
        this.setGoal('wander', randomFreePosition(game.obstacles, { margin: 40, area, tries: 30 }));
      }
    }
  }

  setGoal(mode, goal) {
    this.mode = mode;
    this.goal = goal;
  }

  // L'ennemi visible le plus proche (à portée de vue et sans obstacle entre les deux).
  findEnemy() {
    const { p, game } = this;
    let best = null;
    let bestDist = this.level.viewRange;
    for (const other of game.players.values()) {
      if (other === p || !other.alive || game.time < other.invulnerableUntil) continue;
      const d = distance(p.x, p.y, other.x, other.y);
      if (d < bestDist && hasLineOfSight(p.x, p.y, other.x, other.y, game.obstacles)) {
        best = other;
        bestDist = d;
      }
    }
    return best;
  }

  wantsItem(item) {
    const { p } = this;
    if (item.kind === 'plate') return p.shield < PLAYER.MAX_SHIELD;
    if (p.slots.includes(item.weapon)) return false;
    if (p.slots.includes(null)) return true;
    const worst = Math.min(...p.slots.map((w) => WEAPON_RANK[w]));
    return WEAPON_RANK[item.weapon] > worst;
  }

  findLoot(maxDist) {
    const { p } = this;
    const unarmed = !p.slots.some(Boolean);
    let best = null;
    let bestScore = Infinity;
    for (const item of this.game.loot) {
      const d = distance(p.x, p.y, item.x, item.y);
      if (d > maxDist || !this.wantsItem(item)) continue;
      // Sans arme, une arme compte double
      const score = unarmed && item.kind === 'weapon' ? d * 0.5 : d;
      if (score < bestScore) {
        best = item;
        bestScore = score;
      }
    }
    return best;
  }

  // ---------- Action (à chaque tick) ----------

  act(dt) {
    const { p } = this;
    p.input.shoot = false;
    let moveAngle = null;

    if (this.mode === 'fight' && this.enemy?.alive) {
      moveAngle = this.fight(dt);
    } else if (this.goal) {
      const d = distance(p.x, p.y, this.goal.x, this.goal.y);
      if (d > 8) moveAngle = Math.atan2(this.goal.y - p.y, this.goal.x - p.x);
      if (moveAngle !== null) p.input.angle = moveAngle;
      if (this.mode === 'loot' && d <= PLAYER.PICKUP_RADIUS) this.swapIfBetter();
    }

    if (moveAngle === null) {
      p.input.mx = 0;
      p.input.my = 0;
      this.stuck = { x: p.x, y: p.y, timer: 0.5 };
      return;
    }
    moveAngle = this.avoidObstacles(dt, moveAngle);
    p.input.mx = Math.cos(moveAngle);
    p.input.my = Math.sin(moveAngle);
  }

  // Vise, tire et se positionne. Renvoie la direction de déplacement.
  fight(dt) {
    const { p, game, enemy, level } = this;
    const d = distance(p.x, p.y, enemy.x, enemy.y);
    this.chooseWeapon(d);
    const weapon = p.slots[p.current];

    // Les bons bots visent là où la cible sera quand la balle arrivera
    let tx = enemy.x;
    let ty = enemy.y;
    if (level.leadTarget && weapon) {
      const travelTime = d / WEAPONS[weapon].bulletSpeed;
      tx += enemy.vx * travelTime;
      ty += enemy.vy * travelTime;
    }
    p.input.angle = Math.atan2(ty - p.y, tx - p.x) + this.aimOffset;

    const reacted = game.time - this.enemySince >= level.reaction;
    p.input.shoot = Boolean(weapon) && reacted && d <= WEAPONS[weapon].range * 0.95;

    // Garder la bonne distance pour son arme, et se décaler sur le côté pour esquiver
    this.strafeTimer -= dt;
    if (this.strafeTimer <= 0) {
      this.strafeTimer = randomBetween(0.6, 1.4);
      this.strafeDir = Math.random() < 0.5 ? -1 : 1;
      this.strafing = Math.random() < level.strafe;
    }
    const ideal = IDEAL_RANGE[weapon] ?? 300;
    const toEnemy = Math.atan2(enemy.y - p.y, enemy.x - p.x);
    let fx = 0;
    let fy = 0;
    if (d > ideal + 80) { fx += Math.cos(toEnemy); fy += Math.sin(toEnemy); }
    if (d < ideal - 80) { fx -= Math.cos(toEnemy); fy -= Math.sin(toEnemy); }
    if (this.strafing) {
      fx += Math.cos(toEnemy + (Math.PI / 2) * this.strafeDir);
      fy += Math.sin(toEnemy + (Math.PI / 2) * this.strafeDir);
    }
    return fx === 0 && fy === 0 ? null : Math.atan2(fy, fx);
  }

  // Prend l'arme la plus adaptée à la distance (seulement si le gain est net, pour ne pas alterner sans arrêt).
  chooseWeapon(d) {
    const { p, game } = this;
    const score = (w) => Math.abs(d - IDEAL_RANGE[w]) + (d > WEAPONS[w].range ? 2000 : 0);
    const current = p.slots[p.current];
    const other = p.slots[1 - p.current];
    if (!other) return;
    if (!current || score(other) < score(current) - 150) game.switchWeapon(p.id, 1 - p.current);
  }

  // Sur une arme meilleure que la sienne avec les mains pleines : on échange la moins bonne.
  swapIfBetter() {
    const { p, game, goal } = this;
    if (goal.kind !== 'weapon' || p.slots.includes(null) || !game.loot.includes(goal)) return;
    const worstSlot = WEAPON_RANK[p.slots[0]] <= WEAPON_RANK[p.slots[1]] ? 0 : 1;
    game.switchWeapon(p.id, worstSlot);
    game.pickUp(p.id);
  }

  // S'il n'avance plus (bloqué contre un obstacle), il part sur le côté un court instant.
  avoidObstacles(dt, angle) {
    const { p } = this;
    if (this.detour) {
      this.detour.timer -= dt;
      if (this.detour.timer > 0) return this.detour.angle;
      this.detour = null;
    }
    this.stuck.timer -= dt;
    if (this.stuck.timer <= 0) {
      if (distance(p.x, p.y, this.stuck.x, this.stuck.y) < 25) {
        const side = Math.random() < 0.5 ? 1 : -1;
        this.detour = { angle: angle + side * randomBetween(1.2, 2), timer: randomBetween(0.4, 0.8) };
      }
      this.stuck = { x: p.x, y: p.y, timer: 0.5 };
    }
    return angle;
  }
}
