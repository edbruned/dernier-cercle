// La simulation d'une partie. Le serveur appelle update() 30 fois par seconde :
// c'est lui qui décide de tout (déplacements, tirs, dégâts), les navigateurs ne font qu'afficher.
import { GAME, MAP, PLATE, PLAYER, PLAYER_COLORS, WEAPONS, ZONE, BOT_LEVELS } from '../shared/config.js';
import { clamp, distance, distanceToSegment, pushOutOfObstacle, segmentCircleT, segmentObstacleT } from './geometry.js';
import { generateLoot, generateObstacles, generateZoneCircles, randomFreePosition } from './mapGen.js';
import { Bot } from './Bot.js';

const BOT_NAMES = ['Faucon', 'Lynx', 'Cobra', 'Loup', 'Panthère', 'Requin', 'Vautour', 'Tigre', 'Ours', 'Renard'];

export class Game {
  // humans : [{ id, name }], settings : { difficulty, bots }
  constructor(humans, settings) {
    this.time = 0; // secondes écoulées depuis le début
    this.lastId = 0;
    this.obstacles = generateObstacles();
    this.loot = generateLoot(this.obstacles, () => this.newId());
    this.lootChanged = true;
    this.zoneCircles = generateZoneCircles();
    this.zone = this.computeZone();
    this.bullets = [];
    this.events = []; // éliminations et dégâts à envoyer aux joueurs
    this.players = new Map();
    this.bots = [];
    this.over = false;
    this.result = null;
    this.difficulty = settings.difficulty;

    humans.forEach((h) => this.addPlayer(h.id, h.name, false));
    const botCount = clamp(settings.bots, 0, GAME.MAX_PLAYERS - humans.length);
    for (let i = 0; i < botCount; i++) {
      const player = this.addPlayer(`bot-${i}`, `Bot ${BOT_NAMES[i % BOT_NAMES.length]}`, true);
      player.extraCooldown = BOT_LEVELS[settings.difficulty].fireDelay;
      this.bots.push(new Bot(player, this, settings.difficulty));
    }
    this.spawnEveryone();
  }

  newId() {
    return ++this.lastId;
  }

  addPlayer(id, name, isBot) {
    const player = {
      id, name, isBot,
      color: PLAYER_COLORS[this.players.size % PLAYER_COLORS.length],
      x: 0, y: 0, vx: 0, vy: 0, angle: 0,
      health: PLAYER.MAX_HEALTH,
      shield: 0,
      slots: [null, null], // 2 emplacements d'arme, vides au départ (mains nues)
      current: 0,
      alive: true,
      eliminated: false, // éliminé définitivement (plus de respawn)
      respawnsLeft: GAME.RESPAWNS_PER_PLAYER,
      respawnAt: null,
      invulnerableUntil: 0,
      nextShotAt: 0,
      extraCooldown: 0,
      kills: 0,
      placement: null,
      killedBy: null,
      zoneDamage: 0,
      input: { mx: 0, my: 0, angle: 0, shoot: false },
    };
    this.players.set(id, player);
    return player;
  }

  // Apparition aléatoire, en gardant les joueurs éloignés les uns des autres.
  spawnEveryone() {
    const spawned = [];
    for (const p of this.players.values()) {
      const pos = randomFreePosition(this.obstacles, {
        margin: PLAYER.RADIUS + 10,
        accept: (x, y) => spawned.every((s) => distance(x, y, s.x, s.y) > 550),
      });
      p.x = pos.x;
      p.y = pos.y;
      spawned.push(pos);
    }
  }

  // ---------- Actions envoyées par les joueurs ----------

  setInput(id, input) {
    const p = this.players.get(id);
    if (!p || p.isBot || typeof input !== 'object' || input === null) return;
    // Les touches deviennent un vecteur de direction (mx, my)
    const mx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const my = (input.down ? 1 : 0) - (input.up ? 1 : 0);
    const len = Math.hypot(mx, my) || 1;
    p.input.mx = mx / len;
    p.input.my = my / len;
    p.input.shoot = Boolean(input.shoot);
    if (Number.isFinite(input.angle)) p.input.angle = input.angle;
  }

  switchWeapon(id, slot) {
    const p = this.players.get(id);
    if (!p || !p.alive || (slot !== 0 && slot !== 1) || slot === p.current) return;
    p.current = slot;
    p.nextShotAt = Math.max(p.nextShotAt, this.time + PLAYER.SWITCH_DELAY);
  }

  // Touche E : ramasser l'arme au sol (ou l'échanger contre l'arme en main).
  pickUp(id) {
    const p = this.players.get(id);
    if (!p || !p.alive) return;
    const item = this.nearestLoot(p, 'weapon');
    if (!item) return;
    this.removeLoot(item);
    const freeSlot = p.slots[p.current] === null ? p.current : p.slots.indexOf(null);
    if (freeSlot !== -1) {
      p.slots[freeSlot] = item.weapon;
    } else {
      this.dropLoot({ kind: 'weapon', weapon: p.slots[p.current] }, p.x, p.y);
      p.slots[p.current] = item.weapon;
    }
    p.nextShotAt = Math.max(p.nextShotAt, this.time + PLAYER.SWITCH_DELAY);
  }

  // Un joueur humain quitte la partie (fermeture de l'onglet).
  removePlayer(id) {
    const p = this.players.get(id);
    if (!p || p.eliminated) return;
    if (p.alive) this.dropWeapons(p);
    p.alive = false;
    p.respawnAt = null;
    this.eliminate(p);
    this.events.push({ type: 'leave', victim: p.name });
  }

  // ---------- Boucle de jeu ----------

  update(dt) {
    if (this.over) return;
    this.time += dt;
    this.zone = this.computeZone();

    for (const bot of this.bots) bot.update(dt);

    for (const p of this.players.values()) {
      if (!p.alive) continue;
      this.movePlayer(p, dt);
      this.autoPickUp(p);
      this.tryShoot(p);
      this.applyZoneDamage(p, dt);
    }

    this.updateBullets(dt);
    this.handleRespawns();
    this.checkEnd();
  }

  movePlayer(p, dt) {
    const { mx, my, angle } = p.input;
    const oldX = p.x;
    const oldY = p.y;
    p.angle = angle;
    p.x += mx * PLAYER.SPEED * dt;
    p.y += my * PLAYER.SPEED * dt;
    // Deux passes pour bien gérer les coins entre deux obstacles
    for (let pass = 0; pass < 2; pass++) {
      for (const o of this.obstacles) pushOutOfObstacle(p, PLAYER.RADIUS, o);
    }
    p.x = clamp(p.x, PLAYER.RADIUS, MAP.SIZE - PLAYER.RADIUS);
    p.y = clamp(p.y, PLAYER.RADIUS, MAP.SIZE - PLAYER.RADIUS);
    p.vx = (p.x - oldX) / dt;
    p.vy = (p.y - oldY) / dt;
  }

  // Ramassage automatique : plaques bleues si le bouclier n'est pas plein,
  // armes si un emplacement est libre et qu'on n'a pas déjà ce modèle.
  autoPickUp(p) {
    for (const item of this.loot) {
      if (distance(p.x, p.y, item.x, item.y) > PLAYER.PICKUP_RADIUS) continue;
      if (item.kind === 'plate' && p.shield < PLAYER.MAX_SHIELD) {
        p.shield = Math.min(PLAYER.MAX_SHIELD, p.shield + PLATE.SHIELD);
        this.removeLoot(item);
        return;
      }
      if (item.kind === 'weapon' && !p.slots.includes(item.weapon)) {
        const slot = p.slots[p.current] === null ? p.current : p.slots.indexOf(null);
        if (slot === -1) continue;
        p.slots[slot] = item.weapon;
        this.removeLoot(item);
        return;
      }
    }
  }

  tryShoot(p) {
    const weaponType = p.slots[p.current];
    if (!p.input.shoot || !weaponType || this.time < p.nextShotAt) return;
    const w = WEAPONS[weaponType];
    p.nextShotAt = this.time + w.cooldown + p.extraCooldown;
    p.invulnerableUntil = 0; // tirer annule l'invincibilité du respawn
    const angle = p.angle + (Math.random() * 2 - 1) * w.spread;
    this.bullets.push({ id: this.newId(), ownerId: p.id, weapon: weaponType, x: p.x, y: p.y, angle, traveled: 0 });
  }

  // Chaque balle avance ; on cherche le premier obstacle ou joueur sur son trajet.
  updateBullets(dt) {
    this.bullets = this.bullets.filter((b) => {
      const w = WEAPONS[b.weapon];
      const step = Math.min(w.bulletSpeed * dt, w.range - b.traveled);
      const x2 = b.x + Math.cos(b.angle) * step;
      const y2 = b.y + Math.sin(b.angle) * step;

      let hitT = Infinity;
      let hitPlayer = null;
      for (const o of this.obstacles) {
        const t = segmentObstacleT(b.x, b.y, x2, y2, o);
        if (t !== null && t < hitT) hitT = t;
      }
      for (const p of this.players.values()) {
        if (!p.alive || p.id === b.ownerId) continue;
        const t = segmentCircleT(b.x, b.y, x2, y2, p.x, p.y, PLAYER.RADIUS);
        if (t !== null && t < hitT) {
          hitT = t;
          hitPlayer = p;
        }
      }

      if (hitPlayer) {
        // Tir à la tête : la trajectoire passe au centre du personnage
        const headshot = distanceToSegment(hitPlayer.x, hitPlayer.y, b.x, b.y, x2, y2) <= PLAYER.HEAD_RADIUS;
        this.damage(hitPlayer, w.damage, this.players.get(b.ownerId), b.weapon, headshot);
        return false;
      }
      if (hitT !== Infinity) return false; // la balle s'arrête sur un obstacle

      b.x = x2;
      b.y = y2;
      b.traveled += step;
      const outOfMap = b.x < 0 || b.y < 0 || b.x > MAP.SIZE || b.y > MAP.SIZE;
      return b.traveled < w.range && !outOfMap;
    });
  }

  // Le bouclier absorbe les dégâts en premier, puis la vie.
  damage(target, amount, attacker, weaponType, headshot = false) {
    if (!target.alive || this.time < target.invulnerableUntil) return;
    const instantKill = headshot && WEAPONS[weaponType]?.headshotKills;
    if (instantKill) {
      amount = target.health + target.shield;
    }
    const absorbed = Math.min(target.shield, amount);
    target.shield -= absorbed;
    target.health -= amount - absorbed;

    if (attacker) {
      this.events.push({ type: 'hit', attackerId: attacker.id, targetId: target.id, x: Math.round(target.x), y: Math.round(target.y), amount: Math.round(amount), headshot: instantKill });
    }
    if (target.health <= 0.001) this.kill(target, attacker, weaponType, instantKill);
  }

  kill(target, attacker, weaponType, headshot) {
    target.alive = false;
    target.health = 0;
    target.shield = 0;
    target.killedBy = attacker?.id ?? null;
    this.dropWeapons(target);
    if (attacker && attacker !== target) attacker.kills++;

    // C'est le moment de la mort qui compte : avant 5:00 de jeu, le respawn est possible.
    const canRespawn = target.respawnsLeft > 0 && this.time < GAME.RESPAWN_CUTOFF;
    if (canRespawn) {
      target.respawnsLeft--;
      target.respawnAt = this.time + GAME.RESPAWN_DELAY;
    } else {
      this.eliminate(target);
    }

    this.events.push({
      type: 'kill',
      killer: attacker?.name ?? null,
      victim: target.name,
      victimId: target.id,
      weapon: weaponType ? WEAPONS[weaponType].name : 'la zone',
      headshot,
      final: !canRespawn,
    });
  }

  eliminate(p) {
    p.eliminated = true;
    p.placement = this.playersInRace().length + 1;
  }

  // Joueurs encore en course : vivants, ou morts qui attendent leur respawn.
  playersInRace() {
    return [...this.players.values()].filter((p) => !p.eliminated);
  }

  handleRespawns() {
    for (const p of this.players.values()) {
      if (p.alive || p.eliminated || p.respawnAt === null || this.time < p.respawnAt) continue;
      // On réapparaît dans la zone sûre, loin des ennemis.
      const enemies = [...this.players.values()].filter((o) => o.alive);
      const pos = randomFreePosition(this.obstacles, {
        margin: PLAYER.RADIUS + 10,
        area: { x: this.zone.nextX, y: this.zone.nextY, r: Math.max(0, this.zone.nextR - 40) },
        accept: (x, y) => enemies.every((e) => distance(x, y, e.x, e.y) > 400),
      });
      Object.assign(p, {
        x: pos.x, y: pos.y,
        alive: true,
        health: PLAYER.MAX_HEALTH,
        shield: 0,
        slots: [GAME.RESPAWN_WEAPON, null],
        current: 0,
        respawnAt: null,
        invulnerableUntil: this.time + GAME.RESPAWN_INVINCIBILITY,
        nextShotAt: this.time + 0.5,
      });
      this.events.push({ type: 'respawn', name: p.name });
    }
  }

  // ---------- Zone ----------

  // Calcule le cercle actuel (qui se réduit progressivement) et le prochain cercle.
  computeZone() {
    let start = 0;
    for (let i = 0; i < ZONE.PHASES.length; i++) {
      const phase = ZONE.PHASES[i];
      const from = this.zoneCircles[i];
      const to = this.zoneCircles[i + 1];
      const shrinkStart = start + phase.wait;
      const shrinkEnd = shrinkStart + phase.shrink;
      if (this.time < shrinkEnd) {
        const k = clamp((this.time - shrinkStart) / phase.shrink, 0, 1);
        return {
          x: from.x + (to.x - from.x) * k,
          y: from.y + (to.y - from.y) * k,
          r: from.r + (to.r - from.r) * k,
          nextX: to.x, nextY: to.y, nextR: to.r,
          shrinking: k > 0,
          // Secondes avant le début de la réduction (ou avant la fin si elle a commencé)
          timer: k > 0 ? shrinkEnd - this.time : shrinkStart - this.time,
          damage: phase.damage,
          phase: i + 1,
        };
      }
      start = shrinkEnd;
    }
    const last = this.zoneCircles[this.zoneCircles.length - 1];
    const lastPhase = ZONE.PHASES[ZONE.PHASES.length - 1];
    return { ...last, nextX: last.x, nextY: last.y, nextR: last.r, shrinking: false, timer: 0, damage: lastPhase.damage, phase: ZONE.PHASES.length };
  }

  isInZone(x, y) {
    return distance(x, y, this.zone.x, this.zone.y) <= this.zone.r;
  }

  applyZoneDamage(p, dt) {
    if (this.isInZone(p.x, p.y)) return;
    // On cumule les fractions de dégâts et on les applique par points entiers
    p.zoneDamage += this.zone.damage * dt;
    if (p.zoneDamage >= 1) {
      const amount = Math.floor(p.zoneDamage);
      p.zoneDamage -= amount;
      p.invulnerableUntil = 0;
      this.damage(p, amount, null, null);
    }
  }

  // ---------- Objets au sol ----------

  nearestLoot(p, kind) {
    let best = null;
    let bestDist = PLAYER.PICKUP_RADIUS;
    for (const item of this.loot) {
      const d = distance(p.x, p.y, item.x, item.y);
      if (item.kind === kind && d <= bestDist) {
        best = item;
        bestDist = d;
      }
    }
    return best;
  }

  removeLoot(item) {
    this.loot = this.loot.filter((l) => l !== item);
    this.lootChanged = true;
  }

  dropLoot(item, x, y) {
    const angle = Math.random() * Math.PI * 2;
    this.loot.push({ id: this.newId(), ...item, x: Math.round(x + Math.cos(angle) * 18), y: Math.round(y + Math.sin(angle) * 18) });
    this.lootChanged = true;
  }

  dropWeapons(p) {
    for (const weapon of p.slots) {
      if (weapon) this.dropLoot({ kind: 'weapon', weapon }, p.x, p.y);
    }
    p.slots = [null, null];
  }

  // ---------- Fin de partie ----------

  checkEnd() {
    const inRace = this.playersInRace();
    const timeUp = this.time >= GAME.DURATION;
    if (inRace.length > 1 && !timeUp) return;

    // Temps écoulé : parmi les survivants, le plus de kills gagne, puis le plus de PV.
    const survivors = inRace.sort((a, b) => b.kills - a.kills || (b.health + b.shield) - (a.health + a.shield));
    survivors.forEach((p, i) => { p.placement = i + 1; });

    const ranking = [...this.players.values()]
      .sort((a, b) => a.placement - b.placement)
      .map((p) => ({ id: p.id, name: p.name, isBot: p.isBot, kills: p.kills, placement: p.placement }));

    // Si les derniers meurent au même instant, le dernier tombé est classé 1er.
    const winner = survivors[0] ?? ranking[0];
    this.over = true;
    this.result = {
      winner: winner ? { id: winner.id, name: winner.name } : null,
      reason: timeUp ? 'time' : 'last',
      ranking,
    };
  }

  // ---------- Données envoyées aux navigateurs ----------

  getMapData() {
    return { size: MAP.SIZE, obstacles: this.obstacles, zoneCircles: this.zoneCircles };
  }

  getState() {
    const state = {
      time: Math.round(this.time * 10) / 10,
      timeLeft: Math.max(0, GAME.DURATION - this.time),
      respawnOpen: this.time < GAME.RESPAWN_CUTOFF,
      inRace: this.playersInRace().length,
      zone: {
        x: Math.round(this.zone.x), y: Math.round(this.zone.y), r: Math.round(this.zone.r),
        nextX: this.zone.nextX, nextY: this.zone.nextY, nextR: this.zone.nextR,
        shrinking: this.zone.shrinking, timer: Math.ceil(this.zone.timer), phase: this.zone.phase, damage: this.zone.damage,
      },
      players: [...this.players.values()].map((p) => ({
        id: p.id, name: p.name, bot: p.isBot, color: p.color,
        x: Math.round(p.x), y: Math.round(p.y), angle: Math.round(p.angle * 100) / 100,
        hp: Math.ceil(p.health), shield: Math.ceil(p.shield),
        slots: p.slots, current: p.current,
        alive: p.alive, eliminated: p.eliminated,
        respawnsLeft: p.respawnsLeft,
        respawnIn: p.respawnAt === null ? null : Math.max(0, Math.ceil(p.respawnAt - this.time)),
        invulnerable: this.time < p.invulnerableUntil,
        kills: p.kills, killedBy: p.killedBy, placement: p.placement,
      })),
      bullets: this.bullets.map((b) => ({ id: b.id, x: Math.round(b.x), y: Math.round(b.y), angle: Math.round(b.angle * 100) / 100, weapon: b.weapon })),
      events: this.events,
    };
    this.events = [];
    return state;
  }

  takeLootIfChanged() {
    if (!this.lootChanged) return null;
    this.lootChanged = false;
    return this.loot;
  }
}
