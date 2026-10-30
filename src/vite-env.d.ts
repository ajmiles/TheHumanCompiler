declare module '*.css' {}

/** Audio files imported by URL (Vite emits them as hashed assets). */
declare module '*.mp3' {
  const url: string;
  export default url;
}
