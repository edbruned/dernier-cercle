// Clavier et souris. On utilise event.code (position physique de la touche) :
// "KeyW" correspond à Z sur un clavier AZERTY et à W sur un QWERTY, donc ZQSD et WASD marchent tous les deux.
const MOVE_KEYS = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
};

export class Input {
  // actions : { pickup(), switchTo(slot), toggleWeapon(), nextSpectate() }
  constructor(canvas, actions) {
    this.canvas = canvas;
    this.enabled = false;
    this.keys = { up: false, down: false, left: false, right: false };
    this.mouse = { x: 0, y: 0, down: false };
    this.lastWheel = 0;

    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (MOVE_KEYS[e.code]) {
        this.keys[MOVE_KEYS[e.code]] = true;
        e.preventDefault();
      } else if (e.code === 'KeyE' && !e.repeat) actions.pickup();
      else if (e.code === 'Digit1' || e.code === 'Numpad1') actions.switchTo(0);
      else if (e.code === 'Digit2' || e.code === 'Numpad2') actions.switchTo(1);
      else if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) actions.nextSpectate();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (MOVE_KEYS[e.code]) this.keys[MOVE_KEYS[e.code]] = false;
    });
    // Si la fenêtre perd le focus, on relâche tout (sinon le joueur continue d'avancer tout seul)
    window.addEventListener('blur', () => this.reset());

    canvas.addEventListener('mousemove', (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.mouse.down = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.down = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      // Un pavé tactile envoie des dizaines d'événements : un seul changement toutes les 200 ms
      const now = performance.now();
      if (!this.enabled || now - this.lastWheel < 200) return;
      this.lastWheel = now;
      actions.toggleWeapon();
    }, { passive: false });
  }

  reset() {
    for (const k of Object.keys(this.keys)) this.keys[k] = false;
    this.mouse.down = false;
  }

  // Le joueur est toujours dessiné au centre de l'écran : l'angle de visée part du centre.
  aimAngle() {
    const rect = this.canvas.getBoundingClientRect();
    return Math.atan2(this.mouse.y - rect.top - rect.height / 2, this.mouse.x - rect.left - rect.width / 2);
  }

  snapshot() {
    return { ...this.keys, shoot: this.mouse.down, angle: Math.round(this.aimAngle() * 1000) / 1000 };
  }
}
