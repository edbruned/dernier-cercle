# Présentation (5 minutes)

## 1. Le jeu (30 s)

- **Dernier Cercle** : un battle royale 2D vu de dessus, jouable dans le navigateur, sans installation.
- 10 joueurs maximum (humains + bots), apparition au hasard sur la carte, **les mains vides**.
- 4 armes (pistolet 18, M16 30, pompe 60, sniper 105 de dégâts), plaques bleues (+50 de bouclier, 200 PV max).
- Une zone qui rétrécit, 10 minutes maximum, 1 respawn possible seulement pendant les 5 premières minutes.

## 2. Démo (1 min 30)

1. Accueil : les règles affichées sont **générées depuis le fichier de configuration**.
2. Salon : l'hôte choisit le niveau des bots (Débutant → Légende) et leur nombre.
3. En partie : ramasser une arme, une plaque, tirer, montrer la zone et la minicarte.
4. Mourir : écran de respawn, retour avec un pistolet.

Astuce : ouvre le site en ligne 2 minutes avant (le serveur gratuit met ~1 minute à se réveiller).

## 3. Comment ça marche (2 min)

```
 Navigateur (joueur)                        Serveur Node.js
 ┌────────────────────┐   commandes 30/s   ┌──────────────────────────┐
 │ input.js  clavier  │ ─────────────────► │ server.js  salon, boucle │
 │ renderer.js canvas │                    │ Game.js    simulation    │
 │ main.js    HUD     │ ◄───────────────── │ Bot.js     bots          │
 └────────────────────┘   état 30/s        └──────────────────────────┘
              ▲                                       ▲
              └──────────── shared/config.js ─────────┘
```

- **Socket.IO** : connexion WebSocket permanente, les messages partent dans les deux sens sans recharger la page.
- **Le serveur décide de tout** ("serveur autoritaire") : le navigateur envoie seulement « j'appuie sur Z, je vise à 30°, je clique ». Le serveur calcule les positions, les balles et les dégâts. Impossible de tricher en modifiant sa page.
- **Boucle de jeu à 30 images/s** (`setInterval` dans `server.js`) : bots → déplacements → ramassage → tirs → balles → zone → respawns → fin de partie.
- **Fluidité** : l'écran affiche 60 images/s mais n'en reçoit que 30 → on dessine une position intermédiaire entre les deux derniers états (interpolation, `main.js`).
- **Tirs** : à chaque tick, une balle est un petit segment. On calcule où ce segment touche un cercle (joueur) ou un rectangle (caisse), et on garde le premier contact (`geometry.js`). Si la trajectoire passe à moins de 7 px du centre de la cible avec le sniper → tir à la tête, mort immédiate.
- **Dégâts** : le bouclier encaisse en premier, puis la vie (`Game.damage`).
- **Bots** : ils réfléchissent 10 fois par seconde avec des priorités : sortir de la zone > combattre > ramasser > explorer. Les 4 niveaux changent seulement des nombres dans la config : temps de réaction, imprécision de visée, distance de vue, et le fait d'anticiper le déplacement de la cible.
- **Un seul fichier de règles** (`shared/config.js`) lu par le serveur et par la page d'accueil.

## 4. Mise en ligne (30 s)

- Code sur GitHub, hébergement gratuit sur **Render** (`render.yaml`).
- Render installe les dépendances (`npm install`) et lance `node server.js`. Le même serveur sert les pages et le temps réel.

## 5. Limites et améliorations (30 s)

- Pas de prédiction côté client : avec un gros ping, le déplacement a un léger retard.
- Les bots repèrent les objets proches sans les "voir".
- Idées : sons, buissons pour se cacher, soins, plusieurs salons en parallèle, classement sauvegardé.

## Questions probables

- **Pourquoi pas Vercel ?** Vercel exécute du code à la demande puis l'arrête ; un jeu temps réel a besoin d'un serveur allumé en permanence avec des connexions WebSocket ouvertes.
- **Pourquoi pas de moteur comme Phaser ?** Le serveur fait toute la physique ; côté navigateur il n'y a qu'à dessiner, et l'API Canvas suffit. Moins de dépendances, et tout le code est à moi et explicable.
- **Que se passe-t-il à 10 minutes s'il reste plusieurs joueurs ?** Le plus d'éliminations gagne, puis le plus de PV.
- **Comment on rejoint ?** Tout le monde ouvre la même adresse ; le premier arrivé est l'hôte et lance la partie. Ceux qui arrivent pendant une partie la regardent en spectateur.
