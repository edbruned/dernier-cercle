// Point d'entrée du navigateur : écrans (accueil, salon, partie), connexion au serveur et boucle d'affichage.
import { BOT_LEVELS, GAME, PLAYER, WEAPONS } from '/shared/config.js';
import { renderRules } from './rules.js';
import { Input } from './input.js';
import { Renderer } from './renderer.js';

const $ = (id) => document.getElementById(id);
const socket = io();

let myId = null;
let myName = null;
let lobby = null; // dernier état du salon reçu
let inGame = false;
let prevState = null; // les deux derniers états reçus, pour interpoler entre eux
let currState = null;
let currAt = 0;
let loot = [];
let spectateId = null;
let gameResult = null;
let lastTotalHp = null;
let endTimer = null;

const renderer = new Renderer($('canvas'), $('minimap'));
const input = new Input($('canvas'), {
  pickup: () => socket.emit('pickup'),
  switchTo: (slot) => socket.emit('switch', slot),
  toggleWeapon: () => {
    const me = findMe();
    if (me?.alive) socket.emit('switch', 1 - me.current);
  },
  nextSpectate: () => {
    const others = (currState?.players ?? []).filter((p) => p.alive && p.id !== myId);
    if (!others.length) return;
    const i = others.findIndex((p) => p.id === spectateId);
    spectateId = others[(i + 1) % others.length].id;
  },
});

renderRules($('rules'));

function showScreen(name) {
  for (const id of ['home', 'lobby', 'game']) $(id).classList.toggle('hidden', id !== name);
  input.enabled = name === 'game';
  if (name !== 'game') input.reset();
}

const findMe = () => currState?.players.find((p) => p.id === myId);
const formatTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// ---------- Accueil ----------

try {
  $('name-input').value = localStorage.getItem('pseudo') ?? '';
} catch { /* stockage indisponible : pas grave */ }

$('join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  myName = $('name-input').value.trim();
  try { localStorage.setItem('pseudo', myName); } catch { /* idem */ }
  socket.emit('join', myName);
});

socket.on('connect', () => {
  $('connection-status').textContent = '';
  if (myName) socket.emit('join', myName); // reconnexion automatique après une coupure
});
socket.on('disconnect', () => {
  inGame = false;
  showScreen('home');
  $('connection-status').textContent = 'Connexion au serveur perdue, reconnexion…';
});
socket.on('joined', ({ id }) => { myId = id; });

// ---------- Salon ----------

for (const [key, level] of Object.entries(BOT_LEVELS)) {
  $('difficulty').add(new Option(level.label, key));
}
const sendSettings = () => socket.emit('settings', { difficulty: $('difficulty').value, bots: Number($('bots').value) });
$('difficulty').addEventListener('change', sendSettings);
$('bots').addEventListener('input', () => { $('bots-value').textContent = $('bots').value; });
$('bots').addEventListener('change', sendSettings);
$('start-button').addEventListener('click', () => socket.emit('start'));

socket.on('lobby', (data) => {
  lobby = data;
  renderLobby();
  if (data.phase === 'lobby') {
    inGame = false;
    gameResult = null;
    showScreen('lobby');
  } else if (!inGame) {
    showScreen('lobby');
  }
});

function renderLobby() {
  const { players, hostId, settings, phase, timeLeft } = lobby;
  const isHost = hostId === myId;
  const maxBots = GAME.MAX_PLAYERS - players.length;
  const bots = Math.max(0, Math.min(settings.bots, maxBots));

  $('lobby-players').innerHTML = players.map((p) => `
    <li class="${p.id === myId ? 'me' : ''}">
      <span>${escapeHtml(p.name)}${p.id === myId ? ' (toi)' : ''}</span>
      ${p.id === hostId ? '<span class="tag">Hôte</span>' : ''}
    </li>`).join('');

  $('difficulty').value = settings.difficulty;
  $('bots').max = maxBots;
  $('bots').value = bots;
  $('bots-value').textContent = bots;
  $('difficulty').disabled = !isHost;
  $('bots').disabled = !isHost;
  $('total-players').textContent = `${players.length} joueur${players.length > 1 ? 's' : ''} + ${bots} bot${bots > 1 ? 's' : ''} (${BOT_LEVELS[settings.difficulty].label}) = ${players.length + bots} / ${GAME.MAX_PLAYERS}`;

  const enoughPlayers = players.length + bots >= 2;
  $('start-button').disabled = !isHost || phase !== 'lobby' || !enoughPlayers;
  const host = players.find((p) => p.id === hostId);
  let hint = '';
  if (phase !== 'lobby') hint = `Partie en cours (environ ${formatTime(timeLeft ?? 0)} restantes). Tu joueras la suivante.`;
  else if (!isHost) hint = `En attente de l'hôte (${escapeHtml(host?.name ?? '…')}) pour lancer la partie.`;
  else if (!enoughPlayers) hint = 'Il faut au moins 2 participants : ajoute un bot ou attends un ami.';
  else hint = 'Partage l’adresse du site : tes amis arriveront dans ce salon.';
  $('start-hint').innerHTML = hint;
  $('lobby-status').textContent = phase === 'lobby' ? 'En attente du lancement' : 'Une partie est en cours';
}

// ---------- Partie ----------

socket.on('gameStart', ({ map, loot: initialLoot }) => {
  inGame = true;
  gameResult = null;
  prevState = null;
  currState = null;
  spectateId = null;
  lastTotalHp = null;
  loot = initialLoot;
  clearInterval(endTimer);
  $('killfeed').innerHTML = '';
  $('overlay').classList.add('hidden');
  renderer.setMap(map);
  showScreen('game');
});

socket.on('loot', (items) => { loot = items; });

socket.on('state', (state) => {
  if (!inGame) return;
  prevState = currState;
  currState = state;
  currAt = performance.now();
  handleEvents(state.events);
  updateHud(state);
});

socket.on('gameOver', (result) => {
  gameResult = result;
  showEndScreen(result);
});

// Envoi des commandes au serveur, 30 fois par seconde
setInterval(() => {
  if (inGame && findMe()?.alive) socket.emit('input', input.snapshot());
}, 1000 / GAME.TICK_RATE);

function handleEvents(events) {
  for (const e of events) {
    if (e.type === 'hit' && e.attackerId === myId) {
      renderer.addFloater(e.x, e.y, e.headshot ? 'HEADSHOT' : e.amount, e.headshot ? '#ff6b6b' : '#ffd43b');
    } else if (e.type === 'kill') {
      const victim = `<strong>${escapeHtml(e.victim)}</strong>`;
      const tag = e.final ? '' : ' <span class="respawn">(respawn)</span>';
      if (!e.killer) addFeed(`${victim} a été pris par la zone${tag}`);
      else addFeed(`<strong>${escapeHtml(e.killer)}</strong> <span class="weapon">[${e.weapon}]</span>${e.headshot ? ' <span class="hs">HEADSHOT</span>' : ''} ${victim}${tag}`);
    } else if (e.type === 'respawn') {
      addFeed(`<strong>${escapeHtml(e.name)}</strong> est de retour`);
    } else if (e.type === 'leave') {
      addFeed(`<strong>${escapeHtml(e.victim)}</strong> a quitté la partie`);
    }
  }
}

function addFeed(html) {
  const li = document.createElement('li');
  li.innerHTML = html;
  $('killfeed').prepend(li);
  while ($('killfeed').children.length > 5) $('killfeed').lastChild.remove();
  setTimeout(() => li.remove(), 7000);
}

function updateHud(state) {
  const me = state.players.find((p) => p.id === myId);
  const z = state.zone;

  $('timer').textContent = formatTime(state.timeLeft);
  $('timer').classList.toggle('late', state.timeLeft < 60);
  $('alive-count').textContent = state.inRace;
  $('kill-count').textContent = me?.kills ?? 0;

  const badge = $('respawn-status');
  if (!me) {
    badge.textContent = 'Spectateur';
    badge.className = 'badge off';
  } else if (me.respawnsLeft > 0 && state.respawnOpen) {
    badge.textContent = `Respawn disponible encore ${formatTime(GAME.RESPAWN_CUTOFF - state.time)}`;
    badge.className = 'badge ok';
  } else {
    badge.textContent = me.respawnsLeft > 0 ? 'Respawn fermé (moins de 5 min)' : 'Respawn utilisé';
    badge.className = 'badge off';
  }

  const finalZone = !z.shrinking && z.timer <= 0;
  $('zone-info').textContent = finalZone ? 'Zone finale' : z.shrinking ? `Zone en réduction · ${z.timer} s` : `Réduction de la zone dans ${formatTime(z.timer)}`;
  $('zone-info').classList.toggle('active', z.shrinking);

  const warning = $('zone-warning');
  const outside = me?.alive && Math.hypot(me.x - z.x, me.y - z.y) > z.r;
  if (outside) {
    warning.textContent = `Tu es hors de la zone ! −${z.damage} PV/s`;
    warning.className = 'zone-warning danger';
  } else if (!z.shrinking && z.timer > 0 && z.timer <= 10) {
    warning.textContent = `La zone se réduit dans ${z.timer} s`;
    warning.className = 'zone-warning';
  } else {
    warning.className = 'zone-warning hidden';
  }

  // Barres de vie / bouclier et emplacements d'arme
  const hp = me?.alive ? me.hp : 0;
  const shield = me?.alive ? me.shield : 0;
  $('health-fill').style.width = `${(hp / PLAYER.MAX_HEALTH) * 100}%`;
  $('shield-fill').style.width = `${(shield / PLAYER.MAX_SHIELD) * 100}%`;
  $('health-text').textContent = `${hp} PV`;
  $('shield-text').textContent = shield > 0 ? `${shield} bouclier` : '';
  for (const i of [0, 1]) {
    const weapon = me?.slots[i];
    const slot = $(`slot-${i}`);
    slot.innerHTML = `<span class="key">${i + 1}</span>${weapon ? WEAPONS[weapon].name : 'Vide'}`;
    slot.className = `slot${me?.current === i ? ' active' : ''}${weapon ? '' : ' empty'}`;
  }

  // Flash rouge quand on prend des dégâts
  const total = me?.alive ? hp + shield : null;
  if (total !== null && lastTotalHp !== null && total < lastTotalHp) {
    const flash = $('damage-flash');
    flash.classList.add('on');
    requestAnimationFrame(() => requestAnimationFrame(() => flash.classList.remove('on')));
  }
  lastTotalHp = total;

  if (!gameResult) updateDeathOverlay(state, me);
}

function updateDeathOverlay(state, me) {
  const overlay = $('overlay');
  const watched = state.players.find((p) => p.id === spectateId);
  const watching = watched ? `Tu observes <strong>${escapeHtml(watched.name)}</strong> · <kbd>Espace</kbd> pour changer` : '';
  let html = null;
  if (!me) {
    html = `<p>Partie en cours : tu joueras la prochaine.</p><p>${watching}</p>`;
  } else if (!me.alive && !me.eliminated) {
    const killer = state.players.find((p) => p.id === me.killedBy);
    html = `<h2>Éliminé</h2><p>par ${killer ? `<strong>${escapeHtml(killer.name)}</strong>` : 'la zone'}</p><p>Retour dans <strong>${me.respawnIn ?? 0}</strong> s avec un pistolet</p>`;
  } else if (me.eliminated) {
    html = `<h2>Éliminé · ${me.placement}<sup>e</sup></h2><p>Plus de respawn possible.</p><p>${watching}</p>`;
  }
  overlay.classList.toggle('hidden', html === null);
  overlay.classList.add('compact');
  if (html !== null) overlay.innerHTML = html;
}

function showEndScreen(result) {
  const overlay = $('overlay');
  const won = result.winner?.id === myId;
  const title = won ? '<h2 class="win">Victoire !</h2>' : `<h2>${result.winner ? `${escapeHtml(result.winner.name)} gagne` : 'Fin de partie'}</h2>`;
  const reason = result.reason === 'time'
    ? '<p>Temps écoulé : victoire au nombre d’éliminations.</p>'
    : '<p>Dernier survivant.</p>';
  const rows = result.ranking.map((p) => `
    <tr class="${p.id === myId ? 'me' : ''}"><td>${p.placement}</td><td>${escapeHtml(p.name)}</td><td>${p.kills}</td></tr>`).join('');
  let countdown = GAME.END_SCREEN_DURATION;
  overlay.innerHTML = `${title}${reason}
    <div class="table-wrap"><table><thead><tr><th>#</th><th>Joueur</th><th>Élim.</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="muted small">Retour au salon dans <span id="end-countdown">${countdown}</span> s</p>`;
  overlay.classList.remove('hidden', 'compact');
  clearInterval(endTimer);
  endTimer = setInterval(() => {
    countdown = Math.max(0, countdown - 1);
    const el = $('end-countdown');
    if (el) el.textContent = countdown;
  }, 1000);
}

// ---------- Affichage (60 images par seconde) ----------

const lerp = (a, b, t) => a + (b - a) * t;
function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// Le serveur envoie 30 états par seconde, l'écran en affiche 60 :
// on dessine une position intermédiaire entre les deux derniers états pour que ce soit fluide.
function interpolate(alpha) {
  const prevPlayers = new Map((prevState?.players ?? []).map((p) => [p.id, p]));
  const players = currState.players.map((p) => {
    const old = prevPlayers.get(p.id);
    if (!old || !old.alive || !p.alive) return p;
    return { ...p, x: lerp(old.x, p.x, alpha), y: lerp(old.y, p.y, alpha), angle: lerpAngle(old.angle, p.angle, alpha) };
  });
  const prevBullets = new Map((prevState?.bullets ?? []).map((b) => [b.id, b]));
  const bullets = currState.bullets.map((b) => {
    const old = prevBullets.get(b.id);
    return old ? { ...b, x: lerp(old.x, b.x, alpha), y: lerp(old.y, b.y, alpha) } : b;
  });
  return { players, bullets };
}

function cameraTarget(players, me) {
  if (me?.alive) return me;
  let target = players.find((p) => p.id === spectateId && p.alive);
  if (!target) {
    target = players.find((p) => p.id === me?.killedBy && p.alive) ?? players.find((p) => p.alive && p.id !== myId);
    spectateId = target?.id ?? null;
  }
  return target ?? { x: renderer.map.size / 2, y: renderer.map.size / 2 };
}

function updatePickupHint(me) {
  const hint = $('pickup-hint');
  let text = null;
  if (me?.alive) {
    const near = loot
      .filter((l) => Math.hypot(l.x - me.x, l.y - me.y) <= PLAYER.PICKUP_RADIUS)
      .sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y));
    const weapon = near.find((l) => l.kind === 'weapon');
    if (weapon) {
      const held = me.slots[me.current];
      const full = !me.slots.includes(null);
      text = full && held
        ? `E · Échanger ${WEAPONS[held].name} contre ${WEAPONS[weapon.weapon].name}`
        : `E · Ramasser ${WEAPONS[weapon.weapon].name}`;
    } else if (near.some((l) => l.kind === 'plate') && me.shield >= PLAYER.MAX_SHIELD) {
      text = 'Bouclier déjà plein';
    }
  }
  hint.classList.toggle('hidden', text === null);
  if (text !== null) hint.textContent = text;
}

function frame() {
  requestAnimationFrame(frame);
  if (!inGame || !currState) return;
  const alpha = Math.min(1, (performance.now() - currAt) / (1000 / GAME.TICK_RATE));
  const { players, bullets } = interpolate(alpha);
  const me = players.find((p) => p.id === myId);
  // Notre propre visée suit la souris immédiatement, sans attendre le serveur
  if (me?.alive) me.angle = input.aimAngle();
  const target = cameraTarget(players, me);

  renderer.draw({
    players,
    bullets,
    loot,
    zone: currState.zone,
    camera: { x: target.x, y: target.y },
    meId: myId,
    scoped: me?.alive && me.slots[me.current] === 'sniper',
  });
  updatePickupHint(me);
}
requestAnimationFrame(frame);
