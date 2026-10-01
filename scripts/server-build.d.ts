// The built server that start-self-hosted.ts imports. It exists only after `bun run build`, so
// type checks on a fresh checkout, as in CI, read this declaration instead.
declare module '*/.output/server/index.mjs' {}
