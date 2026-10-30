// ── Background music ──
// Loops one royalty-free track behind the game, with a mute button and a volume slider in the header.
// Browsers only let a page play audio once the player has interacted with it, so the music fades in
// on the first click or key press (unless it was muted on an earlier visit). Nothing is downloaded
// until the music first plays.

import trackUrl from '../assets/music/beauty-flow.mp3';

/** The track, and the credit its Creative Commons licence requires. */
export const MUSIC_TRACK = {
  title: 'Beauty Flow',
  artist: 'Kevin MacLeod',
  site: 'incompetech.com',
  siteUrl: 'https://incompetech.com/',
  license: 'Creative Commons: By Attribution 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
};

const MUSIC_KEY = 'humancompiler_music';
const DEFAULT_VOLUME = 0.4;
const FADE_IN_MS = 2000;
const FADE_OUT_MS = 400;

interface MusicSettings {
  /** Slider position, 0–1. */
  volume: number;
  muted: boolean;
}

function loadSettings(): MusicSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(MUSIC_KEY) ?? 'null');
    if (saved && typeof saved === 'object') {
      const volume = typeof saved.volume === 'number' && Number.isFinite(saved.volume)
        ? Math.min(1, Math.max(0, saved.volume)) : DEFAULT_VOLUME;
      return { volume, muted: saved.muted === true };
    }
  } catch { /* use the defaults */ }
  return { volume: DEFAULT_VOLUME, muted: false };
}

export class MusicPlayer {
  /** The mute button and volume slider, for the header. */
  readonly element: HTMLElement;
  private button: HTMLButtonElement;
  private slider: HTMLInputElement;
  private settings = loadSettings();
  private audio: HTMLAudioElement | null = null;
  /** The player has interacted with the page, so the browser will let it play audio. */
  private unlocked = false;
  private fadeTimer: ReturnType<typeof setInterval> | null = null;

  private readonly onFirstGesture = (e: Event) => {
    // The controls' own handlers deal with clicks on them (a first click on mute should stay silent)
    if (!this.element.contains(e.target as Node)) this.unlock();
  };

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'music-control';

    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'music-control__mute';

    this.slider = document.createElement('input');
    this.slider.type = 'range';
    this.slider.className = 'music-control__volume';
    this.slider.min = '0';
    this.slider.max = '100';
    this.slider.step = '1';
    this.slider.setAttribute('aria-label', 'Music volume');

    this.element.append(this.button, this.slider);

    this.button.addEventListener('click', () => this.setMuted(!this.silent()));
    this.slider.addEventListener('input', () => {
      this.settings.volume = Number(this.slider.value) / 100;
      // Turning the volume up is a request to hear the music
      if (this.settings.volume > 0) this.settings.muted = false;
      this.changed(0);
    });

    window.addEventListener('pointerdown', this.onFirstGesture, true);
    window.addEventListener('keydown', this.onFirstGesture, true);
    this.render();
  }

  /** Nothing is heard: muted, or the volume is at zero. */
  private silent(): boolean {
    return this.settings.muted || this.settings.volume === 0;
  }

  private setMuted(muted: boolean): void {
    this.settings.muted = muted;
    // Unmuting with the slider at zero would still be silent
    if (!muted && this.settings.volume === 0) this.settings.volume = DEFAULT_VOLUME;
    this.changed(muted ? FADE_OUT_MS : FADE_IN_MS);
  }

  /** The settings changed through the controls (a user gesture, so playback is allowed). */
  private changed(fadeMs: number): void {
    try {
      localStorage.setItem(MUSIC_KEY, JSON.stringify(this.settings));
    } catch { /* storage full or disabled: the change still applies to this visit */ }
    this.render();
    this.unlock(fadeMs);
  }

  private unlock(fadeMs = FADE_IN_MS): void {
    if (!this.unlocked) {
      this.unlocked = true;
      window.removeEventListener('pointerdown', this.onFirstGesture, true);
      window.removeEventListener('keydown', this.onFirstGesture, true);
    }
    this.sync(fadeMs);
  }

  /** Start, stop or re-level playback to match the settings. */
  private sync(fadeMs: number): void {
    const { muted, volume } = this.settings;
    // Squaring the slider position makes loudness change roughly evenly along it
    const target = muted ? 0 : volume * volume;
    const audio = this.audio;
    if (target === 0) {
      if (audio && !audio.paused) this.fade(audio, 0, fadeMs, () => audio.pause());
      return;
    }
    if (!this.unlocked) return;
    const player = audio ?? this.createAudio();
    if (!player.paused) {
      this.fade(player, target, fadeMs);
      return;
    }
    player.volume = 0;
    player.play().then(
      // Fade in to whatever the settings are by the time playback has started
      () => this.sync(FADE_IN_MS),
      (e: DOMException) => {
        if (e.name === 'NotAllowedError') {
          // The browser still wants an interaction first: try again on the next one
          this.unlocked = false;
          window.addEventListener('pointerdown', this.onFirstGesture, true);
          window.addEventListener('keydown', this.onFirstGesture, true);
        } else if (e.name !== 'AbortError') {
          console.warn('Background music could not play:', e);
        }
      },
    );
  }

  private createAudio(): HTMLAudioElement {
    const audio = new Audio(trackUrl);
    audio.loop = true;
    audio.preload = 'auto';
    this.audio = audio;
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: MUSIC_TRACK.title, artist: MUSIC_TRACK.artist, album: 'Human Compiler',
      });
      // Media keys and the OS media controls mute and unmute, keeping the header controls in step
      navigator.mediaSession.setActionHandler('play', () => this.setMuted(false));
      navigator.mediaSession.setActionHandler('pause', () => this.setMuted(true));
    }
    return audio;
  }

  private fade(audio: HTMLAudioElement, to: number, ms: number, done?: () => void): void {
    if (this.fadeTimer) clearInterval(this.fadeTimer);
    this.fadeTimer = null;
    const from = audio.volume;
    if (ms <= 0 || from === to) {
      audio.volume = to;
      done?.();
      return;
    }
    // A timer rather than animation frames, so fades still finish while the tab is in the background
    const start = performance.now();
    this.fadeTimer = setInterval(() => {
      const t = Math.min(1, (performance.now() - start) / ms);
      audio.volume = from + (to - from) * t;
      if (t < 1) return;
      clearInterval(this.fadeTimer!);
      this.fadeTimer = null;
      done?.();
    }, 25);
  }

  private render(): void {
    const { muted, volume } = this.settings;
    const silent = this.silent();
    const percent = Math.round(volume * 100);
    this.button.textContent = silent ? '🔇' : volume < 0.34 ? '🔈' : volume < 0.67 ? '🔉' : '🔊';
    this.button.title = `${silent ? 'Play' : 'Mute'} the music: “${MUSIC_TRACK.title}” by ${MUSIC_TRACK.artist} (credits in Settings)`;
    this.button.setAttribute('aria-label', silent ? 'Play music' : 'Mute music');
    this.button.setAttribute('aria-pressed', String(muted));
    this.slider.value = String(percent);
    this.slider.title = `Music volume: ${percent}%`;
    this.slider.style.setProperty('--fill', `${percent}%`);
    this.element.classList.toggle('music-control--muted', silent);
  }
}
