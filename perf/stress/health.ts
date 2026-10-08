export function checkNativeBenchmarkHealth(health: unknown) {
  if (
    typeof health !== 'object' ||
    health === null ||
    !('rate_limit' in health) ||
    health.rate_limit !== false
  ) {
    throw new Error(
      '[stress] Native benchmark requires rate_limit=false in /readyz; set RATE_LIMIT=off',
    )
  }
}
