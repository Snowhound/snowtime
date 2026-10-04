export function getGlobalStartContext() {
  return globalThis.renderContext
}
export function createStart<T>(options: () => T) {
  return { getOptions: options }
}
