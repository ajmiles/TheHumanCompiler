declare module '*.css' {}

/** Audio files imported by URL (Vite emits them as hashed assets). */
declare module '*.mp3' {
  const url: string;
  export default url;
}

/** The parts of Vite's import.meta.env that the app reads. */
interface ImportMetaEnv {
  /** True in the dev server (npm run dev). */
  readonly DEV: boolean;
  /** "1" points a dev build's online leaderboards at the live Firebase project instead of the local emulators. */
  readonly VITE_FIREBASE_PROD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
