// Construit la section "règles" de l'accueil directement à partir de config.js :
// si on change une valeur dans la config, l'explication se met à jour toute seule.
import { BOT_LEVELS, GAME, PLATE, PLAYER, WEAPONS, ZONE } from '/shared/config.js';

const minutes = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function weaponRows() {
  return Object.values(WEAPONS).map((w) => `
    <tr>
      <td><span class="dot" style="background:${w.color}"></span>${w.name}</td>
      <td class="num">${w.damage}</td>
      <td class="num">${(1 / w.cooldown).toFixed(1)} /s</td>
      <td class="num">${w.range} px</td>
      <td>${w.headshotKills ? 'Tir à la tête = mort immédiate' : '—'}</td>
    </tr>`).join('');
}

function botRows() {
  return Object.values(BOT_LEVELS).map((b) => `
    <tr>
      <td><strong>${b.label}</strong></td>
      <td class="num">${b.reaction} s</td>
      <td class="num">± ${Math.round((b.aimError * 180) / Math.PI)}°</td>
      <td class="num">${b.viewRange} px</td>
      <td>${b.leadTarget ? 'Oui' : 'Non'}</td>
    </tr>`).join('');
}

export function renderRules(container) {
  const shrinkStart = ZONE.PHASES[0].wait;
  container.innerHTML = `
    <article class="card">
      <h3>Objectif</h3>
      <p>Jusqu'à <strong>${GAME.MAX_PLAYERS} joueurs</strong> (humains et bots) apparaissent au hasard sur la carte, <strong>les mains vides</strong>.</p>
      <p>Ramasse des armes et des plaques, élimine les autres et sois <strong>le dernier en vie</strong>.</p>
      <p>Une partie dure <strong>${GAME.DURATION / 60} minutes maximum</strong>.</p>
    </article>

    <article class="card">
      <h3>Contrôles</h3>
      <div class="controls">
        <span><kbd>Z</kbd><kbd>Q</kbd><kbd>S</kbd><kbd>D</kbd></span><span>Se déplacer (ou WASD / flèches)</span>
        <span><kbd>Souris</kbd></span><span>Viser</span>
        <span><kbd>Clic</kbd></span><span>Tirer (maintenir pour tirer en continu)</span>
        <span><kbd>E</kbd></span><span>Ramasser une arme / l'échanger contre celle en main</span>
        <span><kbd>1</kbd><kbd>2</kbd></span><span>Choisir son arme (ou molette)</span>
        <span><kbd>Espace</kbd></span><span>Changer de joueur observé (spectateur)</span>
      </div>
    </article>

    <article class="card">
      <h3>Vie et bouclier</h3>
      <p>Tu commences avec <strong>${PLAYER.MAX_HEALTH} PV</strong> (barre blanche) et 0 de bouclier.</p>
      <p>Chaque <strong style="color:var(--shield)">${PLATE.NAME.toLowerCase()}</strong> donne <strong>+${PLATE.SHIELD} de bouclier</strong>, ramassée automatiquement en marchant dessus.</p>
      <p>Maximum : ${PLAYER.MAX_HEALTH} PV + ${PLAYER.MAX_SHIELD} de bouclier = <strong>${PLAYER.MAX_HEALTH + PLAYER.MAX_SHIELD}</strong>. Le bouclier encaisse les dégâts en premier.</p>
      <p>Il n'y a <strong>aucun soin</strong> : la vie perdue ne revient pas.</p>
    </article>

    <article class="card wide">
      <h3>Armes</h3>
      <p>2 emplacements d'arme. Munitions infinies, pas de rechargement. Une arme est ramassée automatiquement si tu as un emplacement libre.</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Arme</th><th>Dégâts / balle</th><th>Cadence</th><th>Portée</th><th>Spécial</th></tr></thead>
          <tbody>${weaponRows()}</tbody>
        </table>
      </div>
    </article>

    <article class="card">
      <h3>La zone</h3>
      <p>Un cercle violet se réduit en ${ZONE.PHASES.length} étapes. Le cercle blanc montre la <strong>prochaine zone sûre</strong>.</p>
      <p>Première réduction après <strong>${minutes(shrinkStart)}</strong>. Hors de la zone, tu perds de ${ZONE.PHASES[0].damage} à ${ZONE.PHASES[ZONE.PHASES.length - 1].damage} PV par seconde selon l'étape.</p>
    </article>

    <article class="card">
      <h3>Respawn</h3>
      <p><strong>${GAME.RESPAWNS_PER_PLAYER} respawn</strong> par partie, seulement si tu meurs pendant les <strong>${GAME.RESPAWN_CUTOFF / 60} premières minutes</strong> (quand il reste plus de ${(GAME.DURATION - GAME.RESPAWN_CUTOFF) / 60} min).</p>
      <p>Retour après ${GAME.RESPAWN_DELAY} s, dans la zone, avec ${PLAYER.MAX_HEALTH} PV, 0 bouclier et un pistolet. ${GAME.RESPAWN_INVINCIBILITY} s d'invincibilité (annulée si tu tires).</p>
      <p>Quand un joueur meurt, ses armes tombent au sol.</p>
    </article>

    <article class="card">
      <h3>Fin de partie</h3>
      <p>La partie s'arrête quand il ne reste qu'<strong>un seul joueur</strong>.</p>
      <p>Si les ${GAME.DURATION / 60} minutes sont écoulées, le survivant avec <strong>le plus d'éliminations</strong> gagne, puis celui qui a le plus de PV en cas d'égalité.</p>
      <p>Après ta mort définitive, tu restes en spectateur.</p>
    </article>

    <article class="card wide">
      <h3>Bots</h3>
      <p>Dans le salon, l'hôte (premier joueur arrivé) choisit le nombre de bots et leur niveau. Tu peux jouer seul contre ${GAME.MAX_PLAYERS - 1} bots.</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Niveau</th><th>Réaction</th><th>Imprécision</th><th>Vision</th><th>Anticipe tes mouvements</th></tr></thead>
          <tbody>${botRows()}</tbody>
        </table>
      </div>
    </article>
  `;
}
