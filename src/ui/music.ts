// ── Background music ──
// A playlist of royalty-free tracks behind the game, with previous/next, mute and volume controls in the
// header. Settings shows each track's credit with a switch that puts it in or takes it out of the playlist.
// Browsers only let a page play audio once the player has interacted with it, so the music fades in on the
// first click or key press (unless it was muted on an earlier visit). A track is only downloaded when it
// first plays.

import beautyFlowUrl from '../assets/music/beauty-flow.mp3';
import halfMysteryUrl from '../assets/music/half-mystery.mp3';

/** A track, and the credit its Creative Commons licence requires. */
export interface MusicTrack {
  id: string;
  title: string;
  artist: string;
  url: string;
  site: string;
  siteUrl: string;
  license: string;
  licenseUrl: string;
}

const KEVIN_MACLEOD = {
  artist: 'Kevin MacLeod',
  site: 'incompetech.com',
  siteUrl: 'https://incompetech.com/',
  license: 'Creative Commons: By Attribution 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
};

/** The playlist, in playing order. */
export const MUSIC_TRACKS: readonly MusicTrack[] = [
  { id: 'beauty-flow', title: 'Beauty Flow', url: beautyFlowUrl, ...KEVIN_MACLEOD },
  { id: 'half-mystery', title: 'Half Mystery', url: halfMysteryUrl, ...KEVIN_MACLEOD },
];

/** A track as Settings shows it. */
export interface TrackState {
  track: MusicTrack;
  /** In the playlist. */
  enabled: boolean;
  /** Being heard now. */
  playing: boolean;
}

const MUSIC_KEY = 'humancompiler_music';
const DEFAULT_VOLUME = 0.4;
const FADE_IN_MS = 2000;       // the music starting, or being unmuted
const FADE_OUT_MS = 400;       // the music being muted
const SKIP_FADE_MS = 300;      // a track being skipped
const TRACK_FADE_IN_MS = 1000; // the next track starting

interface MusicSettings {
  /** Slider position, 0–1. */
  volume: number;
  muted: boolean;
  /** Tracks taken out of the playlist. */
  off: string[];
  /** The track selected last time. */
  track?: string;
}

function loadSettings(): MusicSettings {
  const settings: MusicSettings = { volume: DEFAULT_VOLUME, muted: false, off: [] };
  try {
    const saved = JSON.parse(localStorage.getItem(MUSIC_KEY) ?? 'null');
    if (saved && typeof saved === 'object') {
      const ids = new Set(MUSIC_TRACKS.map(t => t.id));
      if (typeof saved.volume === 'number' && Number.isFinite(saved.volume)) settings.volume = Math.min(1, Math.max(0, saved.volume));
      settings.muted = saved.muted === true;
      if (Array.isArray(saved.off)) settings.off = saved.off.filter((id: unknown) => typeof id === 'string' && ids.has(id));
      // The controls never take every track out: if that is what was saved, play them all
      if (settings.off.length >= MUSIC_TRACKS.length) settings.off = [];
      if (typeof saved.track === 'string' && ids.has(saved.track)) settings.track = saved.track;
    }
  } catch { /* use the defaults */ }
  return settings;
}

const PREV_ICON = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M3 3h2v10H3zM13 3v10L6 8z"/></svg>';
const NEXT_ICON = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M11 3h2v10h-2zM3 3v10l7-5z"/></svg>';

export class MusicPlayer {
  /** The previous/next, mute and volume controls, for the header. */
  readonly element: HTMLElement;
  private prevButton: HTMLButtonElement;
  private muteButton: HTMLButtonElement;
  private nextButton: HTMLButtonElement;
  private slider: HTMLInputElement;
  private settings = loadSettings();
  private audio: HTMLAudioElement | null = null;
  /** The track selected to play. */
  private track: MusicTrack;
  /** The track loaded into `audio`, which differs from `track` until a newly selected one starts. */
  private loaded: MusicTrack | null = null;
  /** The player has interacted with the page, so the browser will let it play audio. */
  private unlocked = false;
  private fadeTimer: ReturnType<typeof setInterval> | null = null;
  private listeners: Array<() => void> = [];

  private readonly onFirstGesture = (e: Event) => {
    // The controls' own handlers deal with clicks on them (a first click on mute should stay silent)
    if (!this.element.contains(e.target as Node)) this.unlock();
  };

  constructor() {
    this.track = this.playlist().find(t => t.id === this.settings.track) ?? this.playlist()[0];

    this.element = document.createElement('div');
    this.element.className = 'music-control';

    const button = (className: string, html = '') => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = className;
      b.innerHTML = html;
      return b;
    };
    this.prevButton = button('music-control__skip', PREV_ICON);
    this.prevButton.setAttribute('aria-label', 'Previous track');
    this.muteButton = button('music-control__mute');
    this.nextButton = button('music-control__skip', NEXT_ICON);
    this.nextButton.setAttribute('aria-label', 'Next track');

    this.slider = document.createElement('input');
    this.slider.type = 'range';
    this.slider.className = 'music-control__volume';
    this.slider.min = '0';
    this.slider.max = '100';
    this.slider.step = '1';
    this.slider.setAttribute('aria-label', 'Music volume');

    this.element.append(this.prevButton, this.muteButton, this.nextButton, this.slider);

    this.prevButton.addEventListener('click', () => this.skip(-1));
    this.nextButton.addEventListener('click', () => this.skip(1));
    this.muteButton.addEventListener('click', () => this.setMuted(!this.silent()));
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

  /** Every track, whether it is in the playlist, and whether it is being heard. */
  tracks(): TrackState[] {
    const heard = !!this.audio && !this.audio.paused && this.target() > 0;
    return MUSIC_TRACKS.map(track => ({ track, enabled: this.isEnabled(track), playing: heard && track === this.loaded }));
  }

  /** Put a track in the playlist or take it out (the last one left stays in: muting turns the music off). */
  setTrackEnabled(id: string, enabled: boolean): void {
    const track = MUSIC_TRACKS.find(t => t.id === id);
    if (!track || enabled === this.isEnabled(track) || (!enabled && this.playlist().length <= 1)) return;
    this.settings.off = enabled ? this.settings.off.filter(o => o !== id) : [...this.settings.off, id];
    // Taking out the selected track moves on to the next one in the playlist
    if (!enabled && track === this.track) this.track = this.neighbour(1, track);
    this.settings.track = this.track.id;
    this.save();
    if (this.audio) this.audio.loop = this.playlist().length === 1;
    this.updateMediaSession();
    this.render();
    this.emit();
    this.sync(TRACK_FADE_IN_MS);
  }

  /** Call `listener` whenever the playlist or what is being heard changes. */
  onChange(listener: () => void): void {
    this.listeners.push(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private isEnabled(track: MusicTrack): boolean {
    return !this.settings.off.includes(track.id);
  }

  /** The tracks in the playlist, in order. */
  private playlist(): MusicTrack[] {
    return MUSIC_TRACKS.filter(t => this.isEnabled(t));
  }

  /** The track `step` places after (1) or before (-1) `from` in the playlist, wrapping around. */
  private neighbour(step: 1 | -1, from = this.track): MusicTrack {
    const list = this.playlist();
    // `from` may just have been taken out of the playlist, so count from its place among all the tracks
    const at = MUSIC_TRACKS.indexOf(from);
    if (step > 0) return list.find(t => MUSIC_TRACKS.indexOf(t) > at) ?? list[0];
    return [...list].reverse().find(t => MUSIC_TRACKS.indexOf(t) < at) ?? list[list.length - 1];
  }

  /** Nothing is heard: muted, or the volume is at zero. */
  private silent(): boolean {
    return this.settings.muted || this.settings.volume === 0;
  }

  /** Volume to play at; squaring the slider position makes loudness change roughly evenly along it. */
  private target(): number {
    return this.settings.muted ? 0 : this.settings.volume * this.settings.volume;
  }

  private save(): void {
    try {
      localStorage.setItem(MUSIC_KEY, JSON.stringify(this.settings));
    } catch { /* storage full or disabled: the change still applies to this visit */ }
  }

  private skip(step: 1 | -1): void {
    if (this.playlist().length < 2) return;
    this.track = this.neighbour(step);
    this.settings.track = this.track.id;
    this.save();
    this.render();
    this.emit();
    // A click on previous/next is an interaction, so the music may start (or change) now
    this.unlock(TRACK_FADE_IN_MS);
  }

  private setMuted(muted: boolean): void {
    this.settings.muted = muted;
    // Unmuting with the slider at zero would still be silent
    if (!muted && this.settings.volume === 0) this.settings.volume = DEFAULT_VOLUME;
    this.changed(muted ? FADE_OUT_MS : FADE_IN_MS);
  }

  /** The settings changed through the controls (a user gesture, so playback is allowed). */
  private changed(fadeMs: number): void {
    this.save();
    this.render();
    this.unlock(fadeMs);
    this.emit();
  }

  private unlock(fadeMs = FADE_IN_MS): void {
    if (!this.unlocked) {
      this.unlocked = true;
      window.removeEventListener('pointerdown', this.onFirstGesture, true);
      window.removeEventListener('keydown', this.onFirstGesture, true);
    }
    this.sync(fadeMs);
  }

  /** Start, stop, re-level or change the track to match the settings. */
  private sync(fadeMs: number): void {
    const target = this.target();
    const audio = this.audio;
    if (target === 0) {
      if (audio && !audio.paused) this.fade(audio, 0, fadeMs, () => audio.pause());
      return;
    }
    if (!this.unlocked) return;
    const player = audio ?? this.createAudio();
    if (this.loaded !== this.track) {
      if (!player.paused) {
        // Fade out the old track before the newly selected one starts
        this.fade(player, 0, SKIP_FADE_MS, () => {
          player.pause();
          this.sync(TRACK_FADE_IN_MS);
        });
        return;
      }
      this.load(player, this.track);
    }
    if (!player.paused) {
      this.fade(player, target, fadeMs);
      return;
    }
    player.volume = 0;
    player.play().then(
      // Fade in to whatever the settings are by the time playback has started
      () => this.sync(Math.max(fadeMs, TRACK_FADE_IN_MS)),
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
    const audio = new Audio();
    audio.preload = 'auto';
    this.audio = audio;
    // With several tracks the playlist moves on at the end of each; a lone track loops by itself
    audio.addEventListener('ended', () => {
      this.track = this.neighbour(1, this.loaded ?? this.track);
      this.settings.track = this.track.id;
      this.save();
      this.render();
      this.sync(TRACK_FADE_IN_MS);
    });
    audio.addEventListener('play', () => this.emit());
    audio.addEventListener('pause', () => this.emit());
    if ('mediaSession' in navigator) {
      // Media keys and the OS media controls drive the same controls as the header
      navigator.mediaSession.setActionHandler('play', () => this.setMuted(false));
      navigator.mediaSession.setActionHandler('pause', () => this.setMuted(true));
    }
    return audio;
  }

  private load(player: HTMLAudioElement, track: MusicTrack): void {
    this.loaded = track;
    player.src = track.url;
    player.loop = this.playlist().length === 1;
    this.updateMediaSession();
  }

  private updateMediaSession(): void {
    if (!this.audio || !('mediaSession' in navigator)) return;
    const session = navigator.mediaSession;
    const track = this.loaded ?? this.track;
    session.metadata = new MediaMetadata({ title: track.title, artist: track.artist, album: 'Human Compiler' });
    const several = this.playlist().length > 1;
    session.setActionHandler('previoustrack', several ? () => this.skip(-1) : null);
    session.setActionHandler('nexttrack', several ? () => this.skip(1) : null);
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
    const name = (t: MusicTrack) => `“${t.title}” by ${t.artist}`;
    this.muteButton.textContent = silent ? '🔇' : volume < 0.34 ? '🔈' : volume < 0.67 ? '🔉' : '🔊';
    this.muteButton.title = `${silent ? 'Play' : 'Mute'} the music: ${name(this.track)} (credits in Settings)`;
    this.muteButton.setAttribute('aria-label', silent ? 'Play music' : 'Mute music');
    this.muteButton.setAttribute('aria-pressed', String(muted));

    const several = this.playlist().length > 1;
    this.prevButton.disabled = !several;
    this.nextButton.disabled = !several;
    const lone = 'Only one track is in the playlist (choose tracks in Settings)';
    this.prevButton.title = several ? `Previous track: ${name(this.neighbour(-1))}` : lone;
    this.nextButton.title = several ? `Next track: ${name(this.neighbour(1))}` : lone;

    this.slider.value = String(percent);
    this.slider.title = `Music volume: ${percent}%`;
    this.slider.style.setProperty('--fill', `${percent}%`);
    this.element.classList.toggle('music-control--muted', silent);
  }
}
