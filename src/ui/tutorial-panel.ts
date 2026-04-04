// ── Tutorial Panel ──
// Replaces the I/O panel when a tutorial is active.

import { Tutorial, TutorialStep } from '../puzzle/tutorials';

export class TutorialPanel {
  private container: HTMLElement;
  private root: HTMLElement;
  private titleEl!: HTMLElement;
  private bodyEl!: HTMLElement;
  private stepIndicator!: HTMLElement;
  private prevBtn!: HTMLButtonElement;
  private nextBtn!: HTMLButtonElement;

  private tutorial: Tutorial | null = null;
  private currentStep = 0;
  private stepChangeCb: ((step: TutorialStep) => void) | null = null;

  constructor(container: HTMLElement) {
    this.container = container;

    this.root = document.createElement('div');
    this.root.className = 'tutorial-panel';
    this.root.style.display = 'none';
    this.buildStructure();
    this.container.appendChild(this.root);
  }

  private buildStructure(): void {
    this.titleEl = document.createElement('div');
    this.titleEl.className = 'tutorial-panel__title';

    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'tutorial-panel__body';

    const nav = document.createElement('div');
    nav.className = 'tutorial-panel__nav';

    this.prevBtn = document.createElement('button');
    this.prevBtn.className = 'tutorial-panel__btn';
    this.prevBtn.textContent = '← Previous';
    this.prevBtn.onclick = () => this.goTo(this.currentStep - 1);

    this.stepIndicator = document.createElement('span');
    this.stepIndicator.className = 'tutorial-panel__indicator';

    this.nextBtn = document.createElement('button');
    this.nextBtn.className = 'tutorial-panel__btn tutorial-panel__btn--primary';
    this.nextBtn.textContent = 'Next →';
    this.nextBtn.onclick = () => this.goTo(this.currentStep + 1);

    nav.append(this.prevBtn, this.stepIndicator, this.nextBtn);
    this.root.append(this.titleEl, this.bodyEl, nav);
  }

  setTutorial(tutorial: Tutorial): void {
    this.tutorial = tutorial;
    this.currentStep = 0;
    this.root.style.display = '';
    this.render();
    this.emitStepChange();
  }

  hide(): void {
    this.root.style.display = 'none';
    this.tutorial = null;
  }

  getCurrentStep(): number {
    return this.currentStep;
  }

  onStepChange(cb: (step: TutorialStep) => void): void {
    this.stepChangeCb = cb;
  }

  private goTo(index: number): void {
    if (!this.tutorial) return;
    if (index < 0 || index >= this.tutorial.steps.length) return;
    this.currentStep = index;
    this.render();
    this.emitStepChange();
  }

  private render(): void {
    if (!this.tutorial) return;
    const step = this.tutorial.steps[this.currentStep];
    const total = this.tutorial.steps.length;

    this.titleEl.textContent = step.title;

    // Render text: split on double newlines for paragraphs
    const paragraphs = step.text.split('\n\n');
    this.bodyEl.innerHTML = paragraphs
      .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)
      .join('');

    this.stepIndicator.textContent = `Step ${this.currentStep + 1} of ${total}`;

    this.prevBtn.disabled = this.currentStep === 0;
    this.nextBtn.disabled = this.currentStep === total - 1;

    if (this.currentStep === total - 1) {
      this.nextBtn.textContent = 'Done ✓';
      this.nextBtn.disabled = true;
    } else {
      this.nextBtn.textContent = 'Next →';
    }
  }

  private emitStepChange(): void {
    if (!this.tutorial || !this.stepChangeCb) return;
    this.stepChangeCb(this.tutorial.steps[this.currentStep]);
  }
}
