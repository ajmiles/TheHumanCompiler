// ── Confirmation Dialog ──
// Asks before something that can't be undone, in front of the screen that asks.

let dialogsShown = 0;

export interface ConfirmOptions {
  title: string;
  /** HTML: escape anything that isn't the game's own. */
  message: string;
  /** The button that goes ahead. */
  confirmLabel: string;
}

/**
 * Ask, in front of everything: true if the player goes ahead. Cancel, Escape or a click outside the box is no, and
 * Cancel has the focus to start with. While it asks, no key reaches the page beneath: Escape doesn't close the screen
 * that asked, and F5 doesn't run the code (or reload the page).
 */
export function confirmDialog({ title, message, confirmLabel }: ConfirmOptions): Promise<boolean> {
  const id = `confirm-dialog-${++dialogsShown}`;
  const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const backdrop = document.createElement('div');
  backdrop.className = 'confirm-dialog';
  backdrop.innerHTML = `
    <div class="confirm-dialog__box" role="alertdialog" aria-modal="true" aria-labelledby="${id}-title"
         aria-describedby="${id}-message">
      <h3 class="confirm-dialog__title" id="${id}-title"></h3>
      <div class="confirm-dialog__message" id="${id}-message">${message}</div>
      <div class="confirm-dialog__buttons">
        <button type="button" class="controls-bar__btn">Cancel</button>
        <button type="button" class="controls-bar__btn controls-bar__btn--danger"></button>
      </div>
    </div>`;
  backdrop.querySelector('.confirm-dialog__title')!.textContent = title;
  const [cancelBtn, confirmBtn] = Array.from(backdrop.querySelectorAll('button'));
  confirmBtn.textContent = confirmLabel;

  return new Promise(resolve => {
    const close = (answer: boolean) => {
      window.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      if (returnFocus?.isConnected) returnFocus.focus();
      resolve(answer);
    };
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        close(false);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        (document.activeElement === cancelBtn ? confirmBtn : cancelBtn).focus();
      } else if (e.key === 'F5' || e.key === 'F10') {
        e.preventDefault(); // the game's run and step keys, so not the browser's either
      }
    };
    // On the window, capturing: before anything beneath sees the key
    window.addEventListener('keydown', onKey, true);
    cancelBtn.addEventListener('click', () => close(false));
    // The second click of a double click on the button that asked lands in here: only a click of its own counts
    confirmBtn.addEventListener('click', e => {
      if (e.detail <= 1) close(true);
    });
    backdrop.addEventListener('click', e => {
      if (e.target === backdrop && e.detail <= 1) close(false);
    });
    document.body.appendChild(backdrop);
    cancelBtn.focus();
  });
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
