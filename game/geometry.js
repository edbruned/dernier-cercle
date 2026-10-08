// Petites fonctions de géométrie utilisées pour les collisions et les tirs.
// Deux formes d'obstacles : cercle { shape: 'circle', x, y, r } et rectangle { shape: 'rect', x, y, w, h }.

export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
export const distance = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
export const randomBetween = (min, max) => min + Math.random() * (max - min);

// Pousse un cercle (joueur) hors d'un obstacle s'il est rentré dedans.
export function pushOutOfObstacle(entity, radius, o) {
  if (o.shape === 'circle') {
    let dx = entity.x - o.x;
    let dy = entity.y - o.y;
    let d = Math.hypot(dx, dy);
    const minDist = radius + o.r;
    if (d >= minDist) return;
    if (d === 0) { dx = 1; dy = 0; d = 1; }
    entity.x = o.x + (dx / d) * minDist;
    entity.y = o.y + (dy / d) * minDist;
    return;
  }

  // Rectangle : on cherche le point du rectangle le plus proche du centre du joueur.
  const cx = clamp(entity.x, o.x, o.x + o.w);
  const cy = clamp(entity.y, o.y, o.y + o.h);
  const dx = entity.x - cx;
  const dy = entity.y - cy;
  const d2 = dx * dx + dy * dy;

  if (d2 === 0) {
    // Le centre est à l'intérieur : on sort par le côté le plus proche.
    const sides = [
      { d: entity.x - o.x, x: o.x - radius, y: entity.y },
      { d: o.x + o.w - entity.x, x: o.x + o.w + radius, y: entity.y },
      { d: entity.y - o.y, x: entity.x, y: o.y - radius },
      { d: o.y + o.h - entity.y, x: entity.x, y: o.y + o.h + radius },
    ];
    const best = sides.reduce((a, b) => (b.d < a.d ? b : a));
    entity.x = best.x;
    entity.y = best.y;
  } else if (d2 < radius * radius) {
    const d = Math.sqrt(d2);
    entity.x = cx + (dx / d) * radius;
    entity.y = cy + (dy / d) * radius;
  }
}

// Distance entre un point et le bord d'un obstacle (négative si le point est dedans).
export function distanceToObstacle(x, y, o) {
  if (o.shape === 'circle') return distance(x, y, o.x, o.y) - o.r;
  const cx = clamp(x, o.x, o.x + o.w);
  const cy = clamp(y, o.y, o.y + o.h);
  if (cx === x && cy === y) return -1;
  return distance(x, y, cx, cy);
}

// Un segment [A -> B] touche-t-il un cercle ? Renvoie t entre 0 et 1
// (0 = au point A, 1 = au point B) au premier contact, ou null.
export function segmentCircleT(ax, ay, bx, by, cx, cy, r) {
  const dx = bx - ax;
  const dy = by - ay;
  const fx = ax - cx;
  const fy = ay - cy;
  const a = dx * dx + dy * dy;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - r * r;
  if (c <= 0) return 0; // A est déjà dans le cercle
  const disc = b * b - 4 * a * c;
  if (a === 0 || disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}

// Même chose avec un rectangle (méthode des "slabs" : on coupe le segment axe par axe).
export function segmentRectT(ax, ay, bx, by, rect) {
  let tMin = 0;
  let tMax = 1;
  const axes = [
    [ax, bx - ax, rect.x, rect.x + rect.w],
    [ay, by - ay, rect.y, rect.y + rect.h],
  ];
  for (const [start, delta, min, max] of axes) {
    if (Math.abs(delta) < 1e-9) {
      if (start < min || start > max) return null;
      continue;
    }
    let t1 = (min - start) / delta;
    let t2 = (max - start) / delta;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }
  return tMin;
}

export function segmentObstacleT(ax, ay, bx, by, o) {
  return o.shape === 'circle'
    ? segmentCircleT(ax, ay, bx, by, o.x, o.y, o.r)
    : segmentRectT(ax, ay, bx, by, o);
}

// Plus courte distance entre un point P et le segment [A -> B].
export function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1);
  return distance(px, py, ax + t * dx, ay + t * dy);
}

// Vrai si aucun obstacle ne coupe la ligne entre A et B.
export function hasLineOfSight(ax, ay, bx, by, obstacles) {
  return !obstacles.some((o) => segmentObstacleT(ax, ay, bx, by, o) !== null);
}
