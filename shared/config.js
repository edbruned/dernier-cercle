// Toutes les règles du jeu sont réunies ici.
// Ce fichier est lu par le serveur (simulation) ET par le navigateur (page d'accueil, HUD) :
// changer une valeur ici change le jeu et les explications affichées en même temps.

export const GAME = {
  NAME: 'Dernier Cercle',
  MAX_PLAYERS: 10,
  DURATION: 600, // durée max d'une partie : 10 minutes
  RESPAWN_CUTOFF: 300, // un joueur mort avant 5:00 de jeu peut revenir, après c'est fini
  RESPAWNS_PER_PLAYER: 1,
  RESPAWN_DELAY: 5, // secondes avant de réapparaître
  RESPAWN_INVINCIBILITY: 3, // secondes d'invincibilité après le respawn (annulée si on tire)
  RESPAWN_WEAPON: 'pistol',
  TICK_RATE: 30, // nombre de mises à jour du serveur par seconde
  END_SCREEN_DURATION: 12, // secondes d'écran de fin avant le retour au salon
};

export const MAP = {
  SIZE: 3600, // carte carrée de 3600 x 3600 pixels
  ROCKS: 42,
  TREES: 56,
  CRATES: 40,
};

export const PLAYER = {
  RADIUS: 20,
  HEAD_RADIUS: 7, // zone centrale du personnage : un tir de sniper ici = tir à la tête
  SPEED: 230, // pixels par seconde
  MAX_HEALTH: 100,
  MAX_SHIELD: 100,
  PICKUP_RADIUS: 42,
  SWITCH_DELAY: 0.25, // délai avant de pouvoir tirer après un changement d'arme
};

export const PLATE = {
  NAME: 'Plaque bleue',
  SHIELD: 50,
  COUNT: 30,
};

// cooldown = temps minimum entre deux tirs (en secondes). Munitions infinies.
export const WEAPONS = {
  pistol: {
    name: 'Pistolet', damage: 18, cooldown: 0.28, range: 750, bulletSpeed: 1500,
    spread: 0.035, count: 15, color: '#d9d9d9', length: 26,
  },
  m16: {
    name: 'M16', damage: 30, cooldown: 0.17, range: 1000, bulletSpeed: 1800,
    spread: 0.06, count: 12, color: '#7bd389', length: 36,
  },
  shotgun: {
    name: 'Fusil à pompe', damage: 60, cooldown: 0.9, range: 380, bulletSpeed: 1400,
    spread: 0.03, count: 9, color: '#ffa94d', length: 32,
  },
  sniper: {
    name: 'Sniper', damage: 105, cooldown: 1.6, range: 2000, bulletSpeed: 3200,
    spread: 0, count: 6, color: '#e599f7', length: 46, headshotKills: true,
  },
};

// La zone : un cercle qui rétrécit. Chaque phase = on attend `wait` secondes,
// puis le cercle se réduit pendant `shrink` secondes jusqu'au rayon `radius`.
// `damage` = points de vie perdus par seconde hors de la zone pendant cette phase.
// La somme des durées fait exactement 600 secondes (10 minutes).
export const ZONE = {
  START_RADIUS: 2600, // couvre toute la carte au début
  PHASES: [
    { wait: 60, shrink: 60, radius: 1550, damage: 1 },
    { wait: 50, shrink: 50, radius: 1000, damage: 2 },
    { wait: 40, shrink: 40, radius: 600, damage: 4 },
    { wait: 45, shrink: 45, radius: 330, damage: 6 },
    { wait: 40, shrink: 50, radius: 150, damage: 10 },
    { wait: 40, shrink: 80, radius: 30, damage: 15 },
  ],
};

// Niveaux de difficulté des bots.
// reaction  : temps (s) avant de tirer sur un ennemi qu'il vient de repérer
// aimError  : imprécision de la visée (en radians, 0 = parfait)
// viewRange : distance à laquelle il repère les ennemis
// fireDelay : temps ajouté entre deux tirs (un débutant tire moins vite)
// strafe    : probabilité de se déplacer latéralement pendant un combat
// leadTarget: anticipe le déplacement de la cible
export const BOT_LEVELS = {
  debutant: {
    label: 'Débutant', reaction: 0.9, aimError: 0.3, viewRange: 550,
    fireDelay: 0.45, strafe: 0, leadTarget: false,
  },
  intermediaire: {
    label: 'Intermédiaire', reaction: 0.55, aimError: 0.16, viewRange: 700,
    fireDelay: 0.2, strafe: 0.4, leadTarget: false,
  },
  pro: {
    label: 'Pro', reaction: 0.3, aimError: 0.08, viewRange: 850,
    fireDelay: 0.08, strafe: 0.8, leadTarget: true,
  },
  legende: {
    label: 'Légende', reaction: 0.15, aimError: 0.035, viewRange: 950,
    fireDelay: 0, strafe: 1, leadTarget: true,
  },
};

export const DEFAULT_SETTINGS = { difficulty: 'intermediaire', bots: 9 };

export const PLAYER_COLORS = [
  '#4dabf7', '#ff6b6b', '#ffd43b', '#69db7c', '#da77f2',
  '#ffa94d', '#3bc9db', '#f783ac', '#a9e34b', '#ced4da',
];
