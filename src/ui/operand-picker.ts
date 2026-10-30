// ── Operand picker ──
// Popup that the Instruction Info panel opens on a bit field, to change the instruction's mnemonic or one
// of its operands. It lists the choices that still assemble and also accepts a typed value.

import { EditChoice } from '../assembler/operand-edit';

export interface PickerPreview {
  /** The source line the value produces. */
  line?: string;
  bytes?: number;
  error?: string;
}

export interface PickerRequest {
  anchor: HTMLElement;
  /** Name and colour of the field, e.g. SRC0. */
  title: string;
  color: string;
  /** Source text of the mnemonic or operand now. */
  current: string;
  /** Size of the instruction now, in bytes. */
  bytes: number;
  choices: EditChoice[];
  /** Mnemonics are listed with their descriptions; operands are shown as a grid of chips. */
  layout: 'list' | 'grid';
  check: (text: string) => PickerPreview;
  apply: (text: string) => void;
  onClose?: () => void;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const HINT = 'Pick a value, or type one and press Enter · Esc closes';

export class OperandPicker {
  private root: HTMLDivElement | null = null;
  private req: PickerRequest | null = null;
  private input!: HTMLInputElement;
  private tabsEl!: HTMLElement;
  private listEl!: HTMLElement;
  private footerEl!: HTMLElement;
  private group = '';
  /** Choices on show, in order. */
  private shown: EditChoice[] = [];
  /** Index in `shown` that Enter applies, or -1. */
  private hot = -1;
  /** The arrow keys have moved `hot`. */
  private navigated = false;

  private readonly onDocumentMouseDown = (e: MouseEvent) => {
    const target = e.target as Node;
    if (this.root?.contains(target) || this.req?.anchor.contains(target)) return;
    this.close();
  };
  private readonly onScroll = (e: Event) => {
    if (!this.root?.contains(e.target as Node)) this.close();
  };
  private readonly onResize = () => this.close();

  /** The field the picker is open on. */
  get anchor(): HTMLElement | null {
    return this.req?.anchor ?? null;
  }

  open(req: PickerRequest): void {
    this.close();
    this.req = req;
    const groups = this.groups();
    this.group = req.choices.find(c => c.current)?.group ?? groups[0] ?? '';

    const root = document.createElement('div');
    root.className = `op-picker op-picker--${req.layout}`;
    root.setAttribute('role', 'dialog');
    root.innerHTML =
      `<div class="op-picker__header">` +
        `<span class="op-picker__title" style="color:${req.color}">${escapeHtml(req.title)}</span>` +
        `<input class="op-picker__input" type="text" spellcheck="false" autocomplete="off" aria-label="${escapeHtml(req.title)}">` +
      `</div>` +
      `<div class="op-picker__tabs" role="tablist"></div>` +
      `<div class="op-picker__body" role="listbox"></div>` +
      `<div class="op-picker__footer"></div>`;
    this.root = root;
    this.input = root.querySelector('.op-picker__input')!;
    this.tabsEl = root.querySelector('.op-picker__tabs')!;
    this.listEl = root.querySelector('.op-picker__body')!;
    this.footerEl = root.querySelector('.op-picker__footer')!;
    this.input.value = req.current;

    this.input.addEventListener('input', () => this.render());
    this.input.addEventListener('keydown', e => this.onKey(e));
    this.tabsEl.addEventListener('click', e => {
      const tab = (e.target as HTMLElement).closest<HTMLElement>('[data-group]');
      if (!tab) return;
      this.group = tab.dataset.group!;
      this.render();
      this.input.focus();
    });
    // Keep the focus in the input when a choice is clicked
    this.listEl.addEventListener('mousedown', e => {
      if ((e.target as HTMLElement).closest('[data-i]')) e.preventDefault();
    });
    this.listEl.addEventListener('click', e => {
      const choice = this.choiceAt(e.target);
      if (choice) this.apply(choice.text);
    });
    this.listEl.addEventListener('mouseover', e => {
      const choice = this.choiceAt(e.target);
      if (choice) this.preview(choice);
    });
    this.listEl.addEventListener('mouseleave', () => this.preview(this.restingChoice()));

    document.body.appendChild(root);
    this.render();
    this.position();
    this.listEl.querySelector('.op-picker__row--current, .op-picker__chip--current')?.scrollIntoView({ block: 'nearest' });
    this.input.focus();
    this.input.select();

    document.addEventListener('mousedown', this.onDocumentMouseDown, true);
    window.addEventListener('scroll', this.onScroll, true);
    window.addEventListener('resize', this.onResize);
  }

  close(restoreFocus = false): void {
    if (!this.root) return;
    document.removeEventListener('mousedown', this.onDocumentMouseDown, true);
    window.removeEventListener('scroll', this.onScroll, true);
    window.removeEventListener('resize', this.onResize);
    const req = this.req;
    this.root.remove();
    this.root = null;
    this.req = null;
    req?.onClose?.();
    if (restoreFocus && req?.anchor.isConnected) req.anchor.focus();
  }

  private apply(text: string): void {
    const req = this.req;
    if (!req) return;
    if (text === req.current) {
      this.close(true);
      return;
    }
    this.close();
    req.apply(text);
  }

  private groups(): string[] {
    return [...new Set(this.req!.choices.map(c => c.group))];
  }

  /** What has been typed, or '' while the input still shows the current value. */
  private query(): string {
    const typed = this.input.value.trim().toLowerCase();
    return typed === this.req!.current.trim().toLowerCase() ? '' : typed;
  }

  private choiceAt(target: EventTarget | null): EditChoice | undefined {
    const el = (target as HTMLElement | null)?.closest<HTMLElement>('[data-i]');
    return el ? this.shown[Number(el.dataset.i)] : undefined;
  }

  /** The choice the footer describes when the mouse is not over one. */
  private restingChoice(): EditChoice | undefined {
    return this.query() || this.navigated ? this.shown[this.hot] : undefined;
  }

  private render(): void {
    const req = this.req!;
    const q = this.query();
    this.navigated = false;
    this.input.classList.remove('op-picker__input--invalid');

    if (req.layout === 'list') {
      this.tabsEl.hidden = true;
      // Match mnemonics by name; if none match, by description (so "multiply" finds every multiply)
      const byName = q ? req.choices.filter(c => c.text.includes(q)) : req.choices;
      this.shown = byName.length > 0 || !q ? byName : req.choices.filter(c => (c.detail ?? '').toLowerCase().includes(q));
      // Enter takes an exact match, else the first name starting with the text (with or without v_/s_), else the first
      const exact = this.shown.findIndex(c => c.text === q);
      const prefix = this.shown.findIndex(c => c.text.startsWith(q) || c.text.replace(/^[a-z]+_/, '').startsWith(q));
      const current = this.shown.findIndex(c => c.current);
      this.hot = this.shown.length === 0 ? -1 : q ? (exact >= 0 ? exact : Math.max(prefix, 0)) : Math.max(current, 0);
    } else {
      const groups = this.groups();
      this.tabsEl.hidden = q !== '' || groups.length < 2;
      this.tabsEl.innerHTML = groups.map(g => this.tabHtml(g)).join('');
      this.shown = q ? req.choices.filter(c => c.text.toLowerCase().startsWith(q)) : req.choices.filter(c => c.group === this.group);
      const exact = this.shown.findIndex(c => c.text.toLowerCase() === q);
      this.hot = q && this.shown.length > 0 ? Math.max(exact, 0) : -1;
    }

    if (this.shown.length === 0) {
      this.listEl.innerHTML = `<div class="op-picker__empty">${req.choices.length ? 'No listed value matches' : 'Type a value'}</div>`;
    } else if (req.layout === 'list') {
      let html = '';
      let group = '';
      this.shown.forEach((c, i) => {
        if (c.group !== group) {
          group = c.group;
          html += `<div class="op-picker__group">${escapeHtml(group)}</div>`;
        }
        html += this.rowHtml(c, i);
      });
      this.listEl.innerHTML = html;
    } else {
      // Short names fill a 16-wide grid, so the 256 VGPRs show as a 16 × 16 register file
      const width = Math.max(...this.shown.map(c => c.text.length));
      const columns = width <= 4 ? 'repeat(16, minmax(0, 1fr))' : `repeat(auto-fill, minmax(${Math.ceil(width * 6.5) + 10}px, 1fr))`;
      this.listEl.innerHTML = `<div class="op-picker__grid" style="grid-template-columns:${columns}">` +
        this.shown.map((c, i) => this.chipHtml(c, i)).join('') + `</div>`;
    }

    this.preview(this.restingChoice());
  }

  private tabHtml(group: string): string {
    const req = this.req!;
    const sizes = new Set(req.choices.filter(c => c.group === group).map(c => c.bytes));
    let note = '';
    if (sizes.size === 1) {
      const delta = [...sizes][0] - req.bytes;
      if (delta) note = `<small title="Every value here makes the instruction ${[...sizes][0]} bytes">${delta > 0 ? '+' : '−'}${Math.abs(delta)} B</small>`;
    }
    const active = group === this.group ? ' op-picker__tab--active' : '';
    return `<button type="button" class="op-picker__tab${active}" data-group="${escapeHtml(group)}" role="tab">${escapeHtml(group)}${note}</button>`;
  }

  private sizeNote(c: EditChoice): string {
    return c.bytes === this.req!.bytes ? '' : `${c.bytes} bytes (now ${this.req!.bytes})`;
  }

  private chipHtml(c: EditChoice, i: number): string {
    let cls = 'op-picker__chip';
    if (c.current) cls += ' op-picker__chip--current';
    if (c.bytes !== this.req!.bytes) cls += ' op-picker__chip--resize';
    if (i === this.hot) cls += ' op-picker__chip--hot';
    const title = [c.line.trim(), this.sizeNote(c)].filter(Boolean).join(' — ');
    return `<div class="${cls}" data-i="${i}" role="option" title="${escapeHtml(title)}">${escapeHtml(c.text)}</div>`;
  }

  private rowHtml(c: EditChoice, i: number): string {
    let cls = 'op-picker__row';
    if (c.current) cls += ' op-picker__row--current';
    if (i === this.hot) cls += ' op-picker__row--hot';
    const size = c.bytes === this.req!.bytes ? '' : `<span class="op-picker__bytes">${c.bytes} B</span>`;
    return `<div class="${cls}" data-i="${i}" role="option" title="${escapeHtml(c.detail ?? '')}">` +
      `<span class="op-picker__mnemonic">${escapeHtml(c.text)}</span>` +
      `<span class="op-picker__desc">${escapeHtml(c.detail ?? '')}</span>${size}</div>`;
  }

  /** Footer: the line a choice (or the typed value) produces and its size, or why the typed value is invalid. */
  private preview(choice?: EditChoice): void {
    const req = this.req;
    if (!req) return;
    let result: PickerPreview | null = choice ? { line: choice.line, bytes: choice.bytes } : null;
    if (!result && this.query()) {
      result = req.check(this.input.value.trim());
      if (result.error) this.input.classList.add('op-picker__input--invalid');
    }
    this.footerEl.classList.toggle('op-picker__footer--error', !!result?.error);
    if (!result) {
      this.footerEl.innerHTML = `<span class="op-picker__hint">${HINT}</span>`;
    } else if (result.error) {
      this.footerEl.textContent = result.error;
    } else {
      const bytes = result.bytes ?? req.bytes;
      const delta = bytes - req.bytes;
      const deltaHtml = delta ? ` <span class="op-picker__delta op-picker__delta--${delta > 0 ? 'up' : 'down'}">(${delta > 0 ? '+' : '−'}${Math.abs(delta)})</span>` : '';
      this.footerEl.innerHTML = `<span class="op-picker__line">${escapeHtml((result.line ?? '').trim())}</span>` +
        `<span class="op-picker__size">${bytes} bytes${deltaHtml}</span>`;
    }
  }

  private onKey(e: KeyboardEvent): void {
    const req = this.req;
    if (!req) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.close(true);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      const typed = this.input.value.trim();
      if (req.layout === 'grid' && this.query() && !req.check(typed).error) this.apply(typed);
      else if (this.shown[this.hot]) this.apply(this.shown[this.hot].text);
      else if (!this.query()) this.close(true);
    } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && req.layout === 'list' && this.shown.length) {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      this.setHot((this.hot + step + this.shown.length) % this.shown.length);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const groups = this.groups();
      if (req.layout === 'grid' && !this.query() && groups.length > 1) {
        const i = groups.indexOf(this.group);
        this.group = groups[(i + (e.shiftKey ? -1 : 1) + groups.length) % groups.length];
        this.render();
      }
    }
  }

  private setHot(index: number): void {
    const cls = this.req!.layout === 'list' ? 'op-picker__row--hot' : 'op-picker__chip--hot';
    this.listEl.querySelector(`.${cls}`)?.classList.remove(cls);
    this.hot = index;
    this.navigated = true;
    const el = this.listEl.querySelector<HTMLElement>(`[data-i="${index}"]`);
    el?.classList.add(cls);
    el?.scrollIntoView({ block: 'nearest' });
    this.preview(this.shown[index]);
  }

  /** Open below the field, or above it when there is more room there. */
  private position(): void {
    const root = this.root!;
    const r = this.req!.anchor.getBoundingClientRect();
    const margin = 8;
    const below = window.innerHeight - r.bottom - margin - 4;
    const above = r.top - margin - 4;
    const height = root.offsetHeight;
    root.style.left = `${Math.max(margin, Math.min(r.left, window.innerWidth - root.offsetWidth - margin))}px`;
    if (height <= below || below >= above) {
      root.style.top = `${r.bottom + 4}px`;
      root.style.maxHeight = `${below}px`;
    } else {
      // Anchored by its bottom edge so it grows upwards, away from the field
      root.style.bottom = `${window.innerHeight - r.top + 4}px`;
      root.style.maxHeight = `${above}px`;
    }
  }
}
