// Serveur du jeu : sert les fichiers du site et gère le multijoueur en temps réel avec Socket.IO.
// Une seule partie à la fois. Les joueurs attendent dans le salon, l'hôte règle les bots et lance.
import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { BOT_LEVELS, DEFAULT_SETTINGS, GAME } from './shared/config.js';
import { Game } from './game/Game.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const app = express();
app.use(express.static(`${root}public`));
app.use('/shared', express.static(`${root}shared`)); // config.js est partagé avec le navigateur

const httpServer = createServer(app);
const io = new Server(httpServer);

// État du salon
const lobby = new Map(); // socket.id -> { id, name }
let hostId = null;
let settings = { ...DEFAULT_SETTINGS };
let phase = 'lobby'; // 'lobby' | 'playing' | 'ended'
let game = null;
const room = () => io.to('joined'); // seuls les joueurs qui ont choisi un pseudo reçoivent les messages

function cleanName(raw) {
  const base = String(raw ?? '').replace(/[^\p{L}\p{N} _\-.]/gu, '').trim().slice(0, 16) || 'Joueur';
  const taken = new Set([...lobby.values()].map((p) => p.name));
  let name = base;
  for (let i = 2; taken.has(name); i++) name = `${base.slice(0, 13)} ${i}`;
  return name;
}

function broadcastLobby() {
  room().emit('lobby', {
    players: [...lobby.values()],
    hostId,
    settings,
    phase,
    timeLeft: game ? Math.ceil(Math.max(0, GAME.DURATION - game.time)) : null,
  });
}

function startGame() {
  const humans = [...lobby.values()];
  const bots = Math.min(settings.bots, GAME.MAX_PLAYERS - humans.length);
  if (humans.length + bots < 2) return;
  game = new Game(humans, { ...settings, bots });
  phase = 'playing';
  room().emit('gameStart', { map: game.getMapData(), loot: game.loot });
  broadcastLobby();
}

function backToLobby() {
  game = null;
  phase = 'lobby';
  broadcastLobby();
}

io.on('connection', (socket) => {
  socket.on('join', (rawName) => {
    if (lobby.has(socket.id)) return;
    lobby.set(socket.id, { id: socket.id, name: cleanName(rawName) });
    socket.join('joined');
    hostId ??= socket.id; // le premier arrivé est l'hôte
    socket.emit('joined', { id: socket.id });
    broadcastLobby();
    // Arrivée pendant une partie : on la regarde en spectateur
    if (game) socket.emit('gameStart', { map: game.getMapData(), loot: game.loot, spectator: true });
  });

  socket.on('settings', (next) => {
    if (socket.id !== hostId || phase !== 'lobby' || typeof next !== 'object' || next === null) return;
    if (BOT_LEVELS[next.difficulty]) settings.difficulty = next.difficulty;
    const bots = Number(next.bots);
    if (Number.isInteger(bots)) settings.bots = Math.max(0, Math.min(GAME.MAX_PLAYERS - 1, bots));
    broadcastLobby();
  });

  socket.on('start', () => {
    if (socket.id === hostId && phase === 'lobby') startGame();
  });

  socket.on('input', (input) => game?.setInput(socket.id, input));
  socket.on('pickup', () => game?.pickUp(socket.id));
  socket.on('switch', (slot) => game?.switchWeapon(socket.id, slot));

  socket.on('disconnect', () => {
    lobby.delete(socket.id);
    if (hostId === socket.id) hostId = lobby.keys().next().value ?? null;
    game?.removePlayer(socket.id);
    broadcastLobby();
  });
});

// Boucle de jeu : 30 fois par seconde on fait avancer la partie et on envoie l'état à tout le monde.
const dt = 1 / GAME.TICK_RATE;
setInterval(() => {
  if (!game || phase !== 'playing') return;

  // Plus aucun humain connecté dans la partie : inutile de continuer
  const humansLeft = [...game.players.values()].some((p) => !p.isBot && lobby.has(p.id));
  if (!humansLeft) {
    backToLobby();
    return;
  }

  game.update(dt);
  room().volatile.emit('state', game.getState()); // "volatile" : un paquet perdu n'est pas renvoyé, le suivant arrive vite
  const loot = game.takeLootIfChanged();
  if (loot) room().emit('loot', loot);

  if (game.over) {
    phase = 'ended';
    room().emit('gameOver', game.result);
    setTimeout(backToLobby, GAME.END_SCREEN_DURATION * 1000);
  }
}, 1000 * dt);

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`${GAME.NAME} : serveur prêt sur http://localhost:${PORT}`));
