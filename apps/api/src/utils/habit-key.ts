export function generateHabitKey(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zа-яё0-9-]/gi, '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
}
