# Dernier Cercle

Battle royale 2D multijoueur jouable dans le navigateur : 10 joueurs maximum (humains + bots), 10 minutes, un seul survivant.

## Lancer le jeu sur son ordinateur

Il faut [Node.js](https://nodejs.org) 20 ou plus.

```bash
npm install
npm start
```

Puis ouvrir http://localhost:3000. Pour tester le multijoueur, il suffit d'ouvrir un deuxième onglet.

## Organisation du code

```
server.js            Serveur web + Socket.IO : salon, hôte, boucle de jeu (30 fois / s)
shared/config.js     TOUTES les règles (armes, vie, zone, respawn, bots). Lu par le serveur ET le navigateur
game/Game.js         Simulation d'une partie : déplacements, tirs, dégâts, zone, respawn, fin
game/Bot.js          Intelligence artificielle des bots (4 niveaux)
game/mapGen.js       Génération aléatoire de la carte, des objets et des zones
game/geometry.js     Collisions (cercles, rectangles, trajectoires des balles)
public/index.html    Les 3 écrans : accueil, salon, partie
public/js/main.js    Côté navigateur : écrans, réception de l'état, HUD
public/js/renderer.js  Dessin de la carte dans un <canvas>
public/js/input.js   Clavier (ZQSD/WASD) et souris
public/js/rules.js   Règles de la page d'accueil, générées depuis config.js
```

## Comment ça marche

1. Chaque navigateur envoie ses commandes au serveur (touches, angle de la souris, clic).
2. Le serveur fait avancer la partie 30 fois par seconde (`Game.update`) : c'est lui qui décide des positions, des tirs et des dégâts. Le joueur ne peut donc pas tricher en modifiant le code de sa page.
3. Après chaque mise à jour, le serveur envoie l'état complet à tous les joueurs (`state`).
4. Le navigateur dessine cet état. Pour que l'image reste fluide à 60 images/s alors qu'il ne reçoit que 30 états/s, il calcule des positions intermédiaires entre les deux derniers états reçus (interpolation).

## Mise en ligne gratuite (Render)

1. Mettre le projet sur GitHub.
2. Créer un compte sur [render.com](https://render.com) (connexion avec GitHub).
3. **New → Blueprint**, choisir le dépôt : le fichier `render.yaml` configure tout (offre gratuite, serveur à Francfort).
4. Attendre la fin du déploiement : le jeu est en ligne à l'adresse `https://<nom>.onrender.com`.

Avec l'offre gratuite, le serveur se met en veille après 15 minutes sans visite : le premier chargement prend alors environ 1 minute. Ouvre le site quelques minutes avant une démonstration.

## Changer les règles

Toutes les valeurs sont dans `shared/config.js` (dégâts, cadence, durée, zone, niveaux des bots…). La page d'accueil se met à jour toute seule.
