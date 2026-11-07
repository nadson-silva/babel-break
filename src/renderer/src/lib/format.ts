/** Formatação de exibição do renderer (M5). */

/** Bytes em unidades legíveis, com decimal regional. */
export function formatBytes(bytes: number, locale?: string): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** exponent
  const decimals = exponent >= 2 ? 1 : 0
  const label = value.toFixed(decimals)
  // PT/ES usam vírgula decimal; os demais, ponto.
  const text = (locale ?? '').toLowerCase().startsWith('pt') || (locale ?? '').toLowerCase().startsWith('es')
    ? label.replace('.', ',')
    : label
  return `${text} ${units[exponent]}`
}
