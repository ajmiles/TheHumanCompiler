// ── Execution Control Bar ──

export class Controls {
  private container: HTMLElement;
  private runBtn!: HTMLButtonElement;
  private stepBtn!: HTMLButtonElement;
  private stopBtn!: HTMLButtonElement;
  private resetBtn!: HTMLButtonElement;
  private speedSlider!: HTMLInputElement;
  private speedLabel!: HTMLSpanElement;
  private cycleEl!: HTMLSpanElement;
  private statusEl!: HTMLSpanElement;

  private stepCb: (() => void) | null = null;
  private runCb: (() => void) | null = null;
  private stopCb: (() => void) | null = null;
  private resetCb: (() => void) | null = null;
  private speedCb: ((speed: number) => void) | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.container.classList.add('controls-bar');
    this.buildControls();
    this.setupKeyboardShortcuts();
  }

  private buildControls(): void {
    // Run button
    this.runBtn = this.createButton('▶ Run', 'controls-bar__btn controls-bar__btn--primary');
    this.runBtn.title = 'Run (F5)';
    this.runBtn.onclick = () => this.runCb?.();

    // Step button
    this.stepBtn = this.createButton('⏭ Step', 'controls-bar__btn');
    this.stepBtn.title = 'Step (F10)';
    this.stepBtn.onclick = () => this.stepCb?.();

    // Stop button
    this.stopBtn = this.createButton('⏹ Stop', 'controls-bar__btn controls-bar__btn--danger');
    this.stopBtn.title = 'Stop (Shift+F5)';
    this.stopBtn.disabled = true;
    this.stopBtn.onclick = () => this.stopCb?.();

    // Reset button
    this.resetBtn = this.createButton('↺ Reset', 'controls-bar__btn');
    this.resetBtn.title = 'Reset (Ctrl+Shift+F5)';
    this.resetBtn.onclick = () => this.resetCb?.();

    // Spacer
    const spacer = document.createElement('div');
    spacer.className = 'controls-bar__spacer';

    // Speed control
    const speedGroup = document.createElement('div');
    speedGroup.className = 'controls-bar__speed';

    const speedText = document.createElement('span');
    speedText.textContent = 'Speed:';

    this.speedSlider = document.createElement('input');
    this.speedSlider.type = 'range';
    this.speedSlider.min = '1';
    this.speedSlider.max = '20';
    this.speedSlider.value = '5';
    this.speedSlider.oninput = () => {
      const val = parseInt(this.speedSlider.value, 10);
      this.speedLabel.textContent = `${val}/s`;
      this.speedCb?.(val);
    };

    this.speedLabel = document.createElement('span');
    this.speedLabel.textContent = '5/s';

    speedGroup.append(speedText, this.speedSlider, this.speedLabel);

    // Cycle counter
    this.cycleEl = document.createElement('span');
    this.cycleEl.className = 'controls-bar__cycle';
    this.cycleEl.textContent = 'Cycle: 0';

    // Status area
    this.statusEl = document.createElement('span');
    this.statusEl.className = 'controls-bar__cycle';

    this.container.append(
      this.runBtn,
      this.stepBtn,
      this.stopBtn,
      this.resetBtn,
      spacer,
      speedGroup,
      this.cycleEl,
      this.statusEl,
    );
  }

  private createButton(text: string, className: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = className;
    btn.textContent = text;
    return btn;
  }

  private setupKeyboardShortcuts(): void {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'F5' && !e.shiftKey && !e.ctrlKey) {
        e.preventDefault();
        this.runCb?.();
      } else if (e.key === 'F10') {
        e.preventDefault();
        this.stepCb?.();
      } else if (e.key === 'F5' && e.shiftKey && !e.ctrlKey) {
        e.preventDefault();
        this.stopCb?.();
      } else if (e.key === 'F5' && e.ctrlKey && e.shiftKey) {
        e.preventDefault();
        this.resetCb?.();
      }
    });
  }

  onStep(cb: () => void): void { this.stepCb = cb; }
  onRun(cb: () => void): void { this.runCb = cb; }
  onStop(cb: () => void): void { this.stopCb = cb; }
  onReset(cb: () => void): void { this.resetCb = cb; }
  onSpeedChange(cb: (speed: number) => void): void { this.speedCb = cb; }

  setRunning(running: boolean): void {
    this.runBtn.disabled = running;
    this.stepBtn.disabled = running;
    this.stopBtn.disabled = !running;
  }

  updateCycle(count: number): void {
    this.cycleEl.textContent = `Cycle: ${count}`;
  }

  setAssembleStatus(errors: number): void {
    if (errors > 0) {
      this.statusEl.textContent = `${errors} error${errors > 1 ? 's' : ''}`;
      this.statusEl.style.color = 'var(--accent-red)';
    } else {
      this.statusEl.textContent = '✓ assembled';
      this.statusEl.style.color = 'var(--accent-green)';
    }
  }
}
