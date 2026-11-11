// ── Sandbox Bar ──
// Shown above the editor in the sandbox, in place of a puzzle's revision tabs: 🔗 Share stores the code
// (src/firebase/shares.ts) and shows its link, which opens the sandbox with that code.

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

  /** The code last shared or opened from a link, and its id. */
  private shared: { source: string; id: string } | null = null;
  /** The share whose link is showing: `shared`, while the editor holds its code. */
  private shownId: string | null = null;
  /** Counts resets, so that a share made before one is dropped. */
  private resets = 0;

  /**
   * @param getSource the editor's code
   * @param canShare whether there's a server to share to (otherwise there's no Share button)
   * @param onLinkChange called with the id of the share whose link starts showing, or null when it stops
   */
  constructor(private getSource: () => string, canShare: boolean, private onLinkChange: (id: string | null) => void) {
    this.element = document.createElement('div');
    this.element.className = 'sandbox-bar';

    const title = document.createElement('span');
    title.className = 'sandbox-bar__title';
    title.textContent = '🧪 Sandbox';

    const spacer = document.createElement('span');
    spacer.className = 'sandbox-bar__spacer';

    this.note = document.createElement('span');
    this.note.className = 'sandbox-bar__note';

    this.link = document.createElement('input');
    this.link.className = 'sandbox-bar__link';
    this.link.readOnly = true;
    this.link.title = 'Anyone with this link sees this code in their sandbox';
    this.link.onfocus = () => this.link.select();

    this.copyBtn = this.button('📋 Copy', 'Copy the link', async () => this.showCopied(await this.copy()));
    this.shareBtn = this.button('🔗 Share', 'Make a link to this code', () => this.share());

    this.element.append(title, spacer, this.note, this.link, this.copyBtn);
    if (canShare) this.element.append(this.shareBtn);
    this.showLink(null);
  }

  /** Forget the last share (on a new sandbox, or on leaving it), and drop a share still being made. */
  reset(): void {
    this.resets++;
    this.shared = null;
    this.showLink(null);
    this.setNote('');
    this.setBusy(false);
  }

  /** The editor holds `source`, which is shared as `id`: show its link. */
  remember(source: string, id: string): void {
    this.shared = { source, id };
    this.refresh();
  }

  /** The editor's code changed: the link shows only while it holds the shared code. */
  codeChanged(): void {
    if (!this.shareBtn.disabled) this.setNote('');
    this.refresh();
  }

  private async share(): Promise<void> {
    const source = this.getSource();
    if (this.shared?.source === source) {
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
    const outcome = await withTimeout(createShare(source), SHARE_TIMEOUT_MS, { ok: false, reason: 'unreachable' });
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
    const id = this.shared && this.getSource() === this.shared.source ? this.shared.id : null;
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
    this.note.className = `sandbox-bar__note sandbox-bar__note--${kind}`;
  }

  private button(text: string, title: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = 'sandbox-bar__btn';
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
