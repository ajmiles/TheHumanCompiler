// ── GPU architecture drop-down (header) ──
// RDNA2 is the architecture the game emulates. The others are listed, greyed out, as coming soon.

const ARCHITECTURES: { name: string; available: boolean }[] = [
  { name: 'RDNA2', available: true },
  { name: 'RDNA3', available: false },
  { name: 'RDNA4', available: false },
];

/**
 * The header's architecture drop-down: a button showing the current architecture, and the list it opens. The arrow
 * keys move through the list, Escape or a click elsewhere closes it.
 */
export function archSelect(): HTMLElement {
  const current = ARCHITECTURES.find(arch => arch.available)!;
  const root = document.createElement('div');
  root.className = 'arch-select';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'arch-select__button';
  button.title = 'GPU architecture';
  button.setAttribute('aria-label', `GPU architecture: ${current.name}`);
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');
  button.innerHTML = `${current.name}<span class="arch-select__caret">▾</span>`;

  const menu = document.createElement('div');
  menu.className = 'arch-select__menu';
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', 'GPU architecture');
  menu.hidden = true;

  const open = () => {
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
  };
  const close = (refocus: boolean) => {
    if (menu.hidden) return;
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (refocus) button.focus();
  };

  const options = ARCHITECTURES.map(arch => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'arch-select__option';
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', String(arch === current));
    option.tabIndex = -1;
    option.textContent = arch.name;
    if (!arch.available) {
      // Not `disabled`, which would take it out of reach of the keyboard and its tooltip
      option.setAttribute('aria-disabled', 'true');
      option.setAttribute('aria-label', `${arch.name} (coming soon)`);
      option.dataset.tooltip = 'Coming soon';
    }
    option.addEventListener('click', () => {
      if (arch.available) close(true);
    });
    menu.appendChild(option);
    return option;
  });
  const focusOption = (i: number) => options[(i + options.length) % options.length].focus();

  button.addEventListener('click', () => (menu.hidden ? open() : close(false)));
  root.addEventListener('keydown', e => {
    const at = options.findIndex(option => option === document.activeElement);
    if (e.key === 'Escape' && !menu.hidden) {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      open();
      focusOption(at < 0 ? ARCHITECTURES.indexOf(current) : at + (e.key === 'ArrowDown' ? 1 : -1));
    } else if (e.key === 'Tab') {
      close(false);
    }
  });
  // In the capture phase: it closes wherever the click lands, even on something that stops the event going further
  document.addEventListener('mousedown', e => {
    if (!root.contains(e.target as Node)) close(false);
  }, true);

  root.append(button, menu);
  return root;
}
