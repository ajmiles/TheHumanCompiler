// ── Modifier picker ──
// Popup that the Instruction Info panel opens on a modifier field of a VOP3 or VOP3P instruction. CLAMP and
// OMOD list their values; ABS, NEG, NEG_HI, OP_SEL and OP_SEL_HI have a switch per operand, and the panel
// reopens the picker after each switch so that several can be flipped in turn. Each row previews the line it
// produces, and a row that cannot be chosen says why.

import { ModifierOption } from '../assembler/operand-edit';
import { AnchoredPopup, escapeHtml, previewHtml } from './operand-picker';

export interface ModifierPickerRequest {
  anchor: HTMLElement;
  /** Name and colour of the field, e.g. ABS. */
  title: string;
  color: string;
  /** What the field does. */
  intro: string;
  /** 'toggles': each row switches one bit. 'choice': the rows are the field's values. */
  kind: 'toggles' | 'choice';
  options: ModifierOption[];
  /** Words for a clear and a set bit (lo / hi), shown instead of a check box. */
  states?: [string, string];
  /** Size of the instruction now, in bytes. */
  bytes: number;
  /** Row to focus when the picker opens. */
  focus?: number;
  apply: (option: ModifierOption, index: number) => void;
  onClose?: () => void;
}

const HINT = {
  toggles: 'Click a row to switch it · Esc closes',
  choice: 'Pick a value · Esc closes',
};

export class ModifierPicker extends AnchoredPopup<ModifierPickerRequest> {
  private rows: HTMLElement[] = [];
  private footerEl!: HTMLElement;

  open(req: ModifierPickerRequest): void {
    this.close();
    this.req = req;
    const root = document.createElement('div');
    root.className = `op-picker mod-picker mod-picker--${req.kind}`;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', req.title);
    root.innerHTML =
      `<div class="op-picker__header">` +
        `<span class="op-picker__title" style="color:${req.color}">${escapeHtml(req.title)}</span>` +
        `<span class="mod-picker__intro">${escapeHtml(req.intro)}</span>` +
      `</div>` +
      `<div class="mod-picker__rows" role="${req.kind === 'choice' ? 'radiogroup' : 'group'}" aria-label="${escapeHtml(req.title)}">` +
        req.options.map((o, i) => this.rowHtml(req, o, i)).join('') +
      `</div>` +
      `<div class="op-picker__footer"></div>`;
    this.footerEl = root.querySelector('.op-picker__footer')!;
    this.rows = [...root.querySelectorAll<HTMLElement>('.mod-picker__row')];

    const list = root.querySelector<HTMLElement>('.mod-picker__rows')!;
    list.addEventListener('click', e => {
      const i = this.indexAt(e.target);
      if (i >= 0) this.choose(i);
    });
    list.addEventListener('mouseover', e => {
      const i = this.indexAt(e.target);
      if (i >= 0) this.preview(i);
    });
    list.addEventListener('mouseleave', () => this.preview());
    root.addEventListener('keydown', e => this.onKey(e));

    this.show(root, () => this.preview());
    const first = req.kind === 'choice' ? req.options.findIndex(o => o.on) : req.options.findIndex(o => o.line !== undefined);
    this.rows[req.focus ?? Math.max(first, 0)]?.focus();
  }

  private rowHtml(req: ModifierPickerRequest, o: ModifierOption, i: number): string {
    const disabled = o.line === undefined;
    let cls = 'mod-picker__row';
    if (o.on) cls += ' mod-picker__row--on';
    if (disabled) cls += ' mod-picker__row--disabled';
    const text = o.operand !== undefined
      ? `<span class="mod-picker__operand">${escapeHtml(o.operand)}</span>`
      : `<span class="mod-picker__detail">${escapeHtml(o.detail ?? '')}</span>`;
    const states = req.states
      ? `<span class="mod-picker__states" aria-hidden="true">` +
        req.states.map((s, k) => `<span${(k === 1) === o.on ? ' class="mod-picker__state--on"' : ''}>${escapeHtml(s)}</span>`).join('') +
        `</span>`
      : '';
    const mark = req.states ? '' : `<span class="mod-picker__mark" aria-hidden="true"></span>`;
    const size = !disabled && o.bytes !== req.bytes ? `<span class="op-picker__bytes">${o.bytes} B</span>` : '';
    return `<button type="button" class="${cls}" data-i="${i}" role="${req.kind === 'choice' ? 'radio' : 'checkbox'}" ` +
      `aria-checked="${o.on}"${disabled ? ' aria-disabled="true"' : ''}${o.error ? ` title="${escapeHtml(o.error)}"` : ''}>` +
      `${mark}<span class="mod-picker__label">${escapeHtml(o.label)}</span>${text}${states}${size}</button>`;
  }

  private indexAt(target: EventTarget | null): number {
    const row = (target as HTMLElement | null)?.closest<HTMLElement>('[data-i]');
    return row ? Number(row.dataset.i) : -1;
  }

  private choose(index: number): void {
    const req = this.req;
    const option = req?.options[index];
    if (!req || !option) return;
    if (option.line === undefined) {
      this.preview(index); // say why it cannot be chosen
    } else if (req.kind === 'choice' && option.on) {
      this.close(true);
    } else {
      req.apply(option, index);
    }
  }

  /** Footer: the line a row produces and its size, why it cannot be chosen, or (for no row) a hint. */
  private preview(index?: number): void {
    const req = this.req;
    if (!req) return;
    const option = index === undefined ? undefined : req.options[index];
    this.footerEl.classList.toggle('op-picker__footer--error', !!option?.error);
    if (!option) this.footerEl.innerHTML = `<span class="op-picker__hint">${HINT[req.kind]}</span>`;
    else if (option.error) this.footerEl.textContent = option.error;
    else this.footerEl.innerHTML = previewHtml(option.line ?? '', option.bytes ?? req.bytes, req.bytes);
  }

  /** Escape closes; the arrow keys, Tab, Home and End move between rows (Enter and Space press the row). */
  private onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.close(true);
      return;
    }
    const n = this.rows.length;
    const at = this.rows.indexOf(document.activeElement as HTMLElement);
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' || (e.key === 'Tab' && !e.shiftKey) ? 1
      : e.key === 'ArrowUp' || e.key === 'ArrowLeft' || (e.key === 'Tab' && e.shiftKey) ? -1 : 0;
    let next: number;
    if (step) next = at < 0 ? (step > 0 ? 0 : n - 1) : (at + step + n) % n;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    else return;
    e.preventDefault();
    this.rows[next]?.focus();
    this.preview(next);
  }
}
