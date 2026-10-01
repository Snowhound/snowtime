export function parseLoginDomains(value: string): string[] {
  const domains = value.split(',').map((domain) => domain.trim().toLowerCase().replace(/^@/, ''))
  if (
    domains.some((domain) => {
      const labels = domain.split('.')
      return (
        domain.length > 253 ||
        labels.length < 2 ||
        labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
      )
    })
  ) {
    throw new Error('ALLOWED_LOGIN_DOMAINS must contain comma-separated email domains.')
  }
  return [...new Set(domains)]
}

export function loginDomainAllowed(email: string, domains: readonly string[]): boolean {
  if (domains.length === 0) return true
  const parts = email.trim().toLowerCase().split('@')
  return parts.length === 2 && parts[0].length > 0 && domains.includes(parts[1])
}
