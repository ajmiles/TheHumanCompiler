// ── Status Bar Messages ──

export class StatusBar {
  private container: HTMLElement;
  private messageEl: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;

    this.messageEl = document.createElement('span');
    this.messageEl.style.fontSize = '12px';
    this.messageEl.style.fontWeight = '600';

    this.container.appendChild(this.messageEl);
  }

  setStatus(message: string, type: 'info' | 'success' | 'error'): void {
    this.messageEl.textContent = message;

    switch (type) {
      case 'success':
        this.messageEl.className = 'status-pass';
        break;
      case 'error':
        this.messageEl.className = 'status-fail';
        break;
      case 'info':
        this.messageEl.className = 'status-running';
        break;
    }
  }

  clear(): void {
    this.messageEl.textContent = '';
    this.messageEl.className = '';
  }
}
