export async function getHealth(signal?: AbortSignal): Promise<void> {
  const response = await fetch('/api/health', { signal })
  if (!response.ok) throw new Error(`API returned ${response.status}`)
  const body: unknown = await response.json()
  if (
    typeof body !== 'object' || body === null ||
    !('status' in body) || body.status !== 'ok' ||
    !('database' in body) || body.database !== 'ok'
  ) throw new Error('Unexpected health response')
}
