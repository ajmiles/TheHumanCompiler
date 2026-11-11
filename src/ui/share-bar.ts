// ── Share Bar ──
// At the end of the bar above the editor, in the Sandbox and on puzzles: 🔗 Share stores the editor's code
// (src/firebase/shares.ts) and shows its link, which opens that code (on its puzzle, or in the Sandbox).

import { createShare, ShareOutcome } from '../firebase/shares';
import { MAX_SHARE_CHARS, shareLink } from '../puzzle/share';

/** How long to wait for a share to be stored (a write made offline waits for the network forever). */
const SHARE_TIMEOUT_MS = 15_000;

const PROBLEMS: Record<Exclude<ShareOutcome, { ok: true }>['reason'], string> = {
  'too-long': `Too long to share: the most is ${MAX_SHARE_CHARS.toLocaleString('en-US')} characters`,
  unreachable: "Couldn't reach the server to share the code",
  failed: "Couldn't share the code",
};

export class ShareBar {
  readonly element: HTMLElement;
  private note: HTMLElement;
  private link: HTMLInputElement;
  private copyBtn: HTMLButtonElement;
  private shareBtn: HTMLButtonElement;

  /** The ids of the code shared, or opened from a link, since the last reset (by the code). */
  private shared = new Map<string, string>();
  /** The share whose link is showing: the editor's code's, if it has one. */
  private shownId: string | null = null;
  /** Counts resets, so that a share made before one is dropped. */
  private resets = 0;

  /**
   * @param getSource the editor's code
   * @param getPuzzleId the puzzle it's for, or null in the Sandbox
   * @param canShare whether there's a server to share to (otherwise there's no Share button)
   * @param onLinkChange called with the id of the share whose link starts showing, or null when it stops
   */
  constructor(private getSource: () => string, private getPuzzleId: () => string | null, canShare: boolean,
              private onLinkChange: (id: string | null) => void) {
    this.element = document.createElement('div');
    this.element.className = 'share-bar';

    this.note = document.createElement('span');
    this.note.className = 'share-bar__note';

    this.link = document.createElement('input');
    this.link.className = 'share-bar__link';
    this.link.readOnly = true;
    this.link.title = 'Anyone with this link can open this code';
    this.link.onfocus = () => this.link.select();

    this.copyBtn = this.button('📋 Copy', 'Copy the link', async () => this.showCopied(await this.copy()));
    this.shareBtn = this.button('🔗 Share', 'Make a link to this code', () => this.share());

    this.element.append(this.note, this.link, this.copyBtn);
    if (canShare) this.element.append(this.shareBtn);
    this.showLink(null);
  }

  /** Forget what was shared (on opening a puzzle, the Sandbox or a tutorial), and drop a share still being made. */
  reset(): void {
    this.resets++;
    this.shared.clear();
    this.showLink(null);
    this.setNote('');
    this.setBusy(false);
  }

  /** `source` is shared as `id`: its link shows while the editor holds it. */
  remember(source: string, id: string): void {
    this.shared.set(source, id);
    this.refresh();
  }

  /** The editor's code changed: the link shows only while it holds code that's shared. */
  codeChanged(): void {
    if (!this.shareBtn.disabled) this.setNote('');
    this.refresh();
  }

  private async share(): Promise<void> {
    const source = this.getSource();
    if (this.shared.has(source)) {
      // Already shared: show the same link again
      this.refresh();
      this.showCopied(await this.copy());
      return;
    }
    if (!source.trim()) {
      this.setNote('Write some code to share first', 'error');
      return;
    }

    const reset = this.resets;
    this.setBusy(true);
    this.setNote('');
    const outcome = await withTimeout(createShare(source, this.getPuzzleId()), SHARE_TIMEOUT_MS, { ok: false, reason: 'unreachable' });
    if (reset !== this.resets) return;
    this.setBusy(false);
    if (!outcome.ok) {
      this.setNote(PROBLEMS[outcome.reason], 'error');
      return;
    }
    this.remember(source, outcome.id);
    // The code may have changed while it was being shared: then its link isn't the editor's code
    if (this.shownId === outcome.id) this.showCopied(await this.copy());
  }

  private refresh(): void {
    const id = this.shared.get(this.getSource()) ?? null;
    if (id === this.shownId) return;
    this.showLink(id);
    this.onLinkChange(id);
  }

  private showLink(id: string | null): void {
    this.shownId = id;
    this.link.value = id ? shareLink(location.href, id) : '';
    this.link.hidden = this.copyBtn.hidden = !id;
  }

  /** Copy the link, with the Clipboard API, or else by selecting it; false if neither works. */
  private async copy(): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(this.link.value);
      return true;
    } catch {
      this.link.focus();
      this.link.select();
      try {
        return document.execCommand('copy');
      } catch {
        return false;
      }
    }
  }

  private showCopied(copied: boolean): void {
    this.setNote(copied ? 'Link copied' : 'Link selected: copy it with Ctrl+C (⌘C)', copied ? 'success' : 'info');
  }

  private setBusy(busy: boolean): void {
    this.shareBtn.disabled = busy;
    this.shareBtn.textContent = busy ? 'Sharing…' : '🔗 Share';
  }

  private setNote(text: string, kind: 'info' | 'success' | 'error' = 'info'): void {
    this.note.textContent = text;
    this.note.className = `share-bar__note share-bar__note--${kind}`;
  }

  private button(text: string, title: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = 'share-bar__btn';
    b.textContent = text;
    b.title = title;
    b.onclick = onClick;
    return b;
  }
}

/** `promise`'s value, or `fallback` if it fails or takes longer than `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      () => { clearTimeout(timer); resolve(fallback); },
    );
  });
}
