// ── Dialogs ──
// In front of the screen that opens them: a question before something that can't be undone, or an explanation.

let dialogsShown = 0;

interface DialogOptions {
  title: string;
  /** HTML: escape anything that isn't the game's own. */
  message: string;
  /** 'danger' asks before something that can't be undone; 'info' explains something. */
  kind: 'danger' | 'info';
  /** The buttons, left to right: the first has the focus to start with. */
  buttons: { label: string; className?: string }[];
}

/**
 * Show a dialog in front of everything, until a button is clicked (its index) or the player gets out of it with Escape
 * or a click outside the box (-1). While it shows, no key reaches the page beneath: Escape doesn't close the screen
 * that opened it, and F5 doesn't run the code (or reload the page).
 */
function openDialog({ title, message, kind, buttons }: DialogOptions): Promise<number> {
  const id = `dialog-${++dialogsShown}`;
  const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const backdrop = document.createElement('div');
  backdrop.className = 'dialog';
  const role = kind === 'danger' ? 'alertdialog' : 'dialog';
  backdrop.innerHTML = `
    <div class="dialog__box dialog__box--${kind}" role="${role}" aria-modal="true" aria-labelledby="${id}-title"
         aria-describedby="${id}-message">
      <h3 class="dialog__title" id="${id}-title"></h3>
      <div class="dialog__message" id="${id}-message">${message}</div>
      <div class="dialog__buttons"></div>
    </div>`;
  backdrop.querySelector('.dialog__title')!.textContent = title;
  const buttonRow = backdrop.querySelector('.dialog__buttons')!;
  const buttonEls = buttons.map(({ label, className }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className ? `controls-bar__btn ${className}` : 'controls-bar__btn';
    button.textContent = label;
    return buttonRow.appendChild(button);
  });

  return new Promise(resolve => {
    const close = (answer: number) => {
      window.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      if (returnFocus?.isConnected) returnFocus.focus();
      resolve(answer);
    };
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        close(-1);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        const at = buttonEls.indexOf(document.activeElement as HTMLButtonElement);
        buttonEls[(at + (e.shiftKey ? buttonEls.length - 1 : 1)) % buttonEls.length].focus();
      } else if (e.key === 'F5' || e.key === 'F10') {
        e.preventDefault(); // the game's run and step keys, so not the browser's either
      }
    };
    // On the window, capturing: before anything beneath sees the key
    window.addEventListener('keydown', onKey, true);
    // The second click of a double click on the button that opened the dialog lands in here: only a click of its own
    // counts
    buttonEls.forEach((button, index) => button.addEventListener('click', e => {
      if (e.detail <= 1) close(index);
    }));
    backdrop.addEventListener('click', e => {
      if (e.target === backdrop && e.detail <= 1) close(-1);
    });
    document.body.appendChild(backdrop);
    buttonEls[0].focus();
  });
}

export interface ConfirmOptions {
  title: string;
  /** HTML: escape anything that isn't the game's own. */
  message: string;
  /** The button that goes ahead. */
  confirmLabel: string;
}

/**
 * Ask, in front of everything: true if the player goes ahead. Cancel, Escape or a click outside the box is no, and
 * Cancel has the focus to start with.
 */
export async function confirmDialog({ title, message, confirmLabel }: ConfirmOptions): Promise<boolean> {
  const buttons = [{ label: 'Cancel' }, { label: confirmLabel, className: 'controls-bar__btn--danger' }];
  return (await openDialog({ title, message, kind: 'danger', buttons })) === 1;
}

/** Explain something, in front of everything, until the player closes it. `message` is HTML, as for confirmDialog(). */
export async function infoDialog(title: string, message: string): Promise<void> {
  await openDialog({ title, message, kind: 'info', buttons: [{ label: 'Close' }] });
}

/** Ask before deleting the player's scores for a puzzle, in this browser (and online, if `online`). */
export function confirmDeleteScores(puzzleTitle: string, online: boolean): Promise<boolean> {
  const puzzle = document.createElement('strong');
  puzzle.textContent = puzzleTitle;
  const boards = online
    ? 'its leaderboards, online and in this browser, Hardware cycles included'
    : "this browser's leaderboards";
  return confirmDialog({
    title: '⚠️ Delete your scores?',
    message: `<p>Your scores for ${puzzle.outerHTML} will be removed from ${boards}. This can't be undone.</p>` +
      '<p>Your solution is kept.</p>',
    confirmLabel: 'Delete Scores',
  });
}
