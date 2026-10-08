// Génération aléatoire de la carte : obstacles, objets au sol et zones successives.
import { MAP, PLATE, WEAPONS, ZONE } from '../shared/config.js';
import { distance, distanceToObstacle, randomBetween } from './geometry.js';

const MIN_GAP = 75; // espace minimum entre deux obstacles : un joueur (40 px) passe toujours
const BORDER = 120;

// Cercle qui englobe un obstacle (sert à espacer les obstacles entre eux).
function boundingCircle(o) {
  if (o.shape === 'circle') return { x: o.x, y: o.y, r: o.r };
  return { x: o.x + o.w / 2, y: o.y + o.h / 2, r: Math.hypot(o.w, o.h) / 2 };
}

function fitsOnMap(o, obstacles) {
  const b = boundingCircle(o);
  if (b.x - b.r < BORDER || b.y - b.r < BORDER) return false;
  if (b.x + b.r > MAP.SIZE - BORDER || b.y + b.r > MAP.SIZE - BORDER) return false;
  return obstacles.every((other) => {
    const ob = boundingCircle(other);
    return distance(b.x, b.y, ob.x, ob.y) > b.r + ob.r + MIN_GAP;
  });
}

// On tire des positions au hasard et on garde celles qui ne chevauchent rien.
function place(obstacles, count, makeObstacle) {
  for (let i = 0; i < count; i++) {
    for (let attempt = 0; attempt < 60; attempt++) {
      const o = makeObstacle();
      if (fitsOnMap(o, obstacles)) {
        obstacles.push(o);
        break;
      }
    }
  }
}

export function generateObstacles() {
  const obstacles = [];
  const rand = () => randomBetween(BORDER, MAP.SIZE - BORDER);

  place(obstacles, MAP.CRATES, () => {
    // Moitié caisses, moitié murs longs (horizontaux ou verticaux)
    const isWall = Math.random() < 0.5;
    const long = randomBetween(180, 320);
    const thick = randomBetween(28, 40);
    const size = randomBetween(60, 120);
    const horizontal = Math.random() < 0.5;
    const w = isWall ? (horizontal ? long : thick) : size;
    const h = isWall ? (horizontal ? thick : long) : size;
    return { type: isWall ? 'wall' : 'crate', shape: 'rect', x: rand(), y: rand(), w, h };
  });
  place(obstacles, MAP.ROCKS, () => ({ type: 'rock', shape: 'circle', x: rand(), y: rand(), r: randomBetween(25, 55) }));
  place(obstacles, MAP.TREES, () => ({ type: 'tree', shape: 'circle', x: rand(), y: rand(), r: randomBetween(28, 46) }));

  return obstacles.map((o) => ({ ...o, x: Math.round(o.x), y: Math.round(o.y) }));
}

// Une position libre au hasard. `accept(x, y)` permet d'ajouter une condition (ex. loin des autres joueurs).
export function randomFreePosition(obstacles, { margin = 30, area = null, accept = () => true, tries = 300 } = {}) {
  let fallback = null;
  for (let i = 0; i < tries; i++) {
    let x;
    let y;
    if (area) {
      // Point au hasard dans un cercle
      const angle = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * area.r;
      x = area.x + Math.cos(angle) * r;
      y = area.y + Math.sin(angle) * r;
    } else {
      x = randomBetween(BORDER / 2, MAP.SIZE - BORDER / 2);
      y = randomBetween(BORDER / 2, MAP.SIZE - BORDER / 2);
    }
    if (x < 40 || y < 40 || x > MAP.SIZE - 40 || y > MAP.SIZE - 40) continue;
    if (!obstacles.every((o) => distanceToObstacle(x, y, o) > margin)) continue;
    if (accept(x, y)) return { x, y };
    fallback ??= { x, y };
  }
  return fallback ?? { x: MAP.SIZE / 2, y: MAP.SIZE / 2 };
}

export function generateLoot(obstacles, nextId) {
  const loot = [];
  const farFromLoot = (x, y) => loot.every((l) => distance(x, y, l.x, l.y) > 90);
  const add = (item) => {
    const pos = randomFreePosition(obstacles, { margin: 25, accept: farFromLoot });
    loot.push({ id: nextId(), ...item, x: Math.round(pos.x), y: Math.round(pos.y) });
  };

  for (const [weapon, def] of Object.entries(WEAPONS)) {
    for (let i = 0; i < def.count; i++) add({ kind: 'weapon', weapon });
  }
  for (let i = 0; i < PLATE.COUNT; i++) add({ kind: 'plate' });
  return loot;
}

// Calcule à l'avance tous les cercles de la zone.
// Chaque nouveau cercle est entièrement contenu dans le précédent.
export function generateZoneCircles() {
  const circles = [{ x: MAP.SIZE / 2, y: MAP.SIZE / 2, r: ZONE.START_RADIUS }];
  for (const phase of ZONE.PHASES) {
    const prev = circles[circles.length - 1];
    // Au début, prev.r est plus grand que la carte : on limite le décalage pour rester dessus.
    const maxShift = Math.min(prev.r - phase.radius, MAP.SIZE / 2 - phase.radius - 100);
    let x = prev.x;
    let y = prev.y;
    if (maxShift > 0) {
      const angle = Math.random() * Math.PI * 2;
      const shift = Math.random() * maxShift;
      x = prev.x + Math.cos(angle) * shift;
      y = prev.y + Math.sin(angle) * shift;
    }
    circles.push({ x: Math.round(x), y: Math.round(y), r: phase.radius });
  }
  return circles;
}
