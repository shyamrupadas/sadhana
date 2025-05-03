import { HabitDefinition, sadhanaDB } from './db/sadhanaDB'

function generateHabitKey(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zа-яё0-9\-]/gi, '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
}

export const habitApi = {
  async getAll(): Promise<HabitDefinition[]> {
    return await sadhanaDB.habitDefinitions.toArray()
  },

  async add(label: string): Promise<void> {
    const key = generateHabitKey(label)
    const now = new Date().toISOString()

    const existing = await sadhanaDB.habitDefinitions.get(key)
    if (existing) return

    const habit: HabitDefinition = {
      key,
      label,
      createdAt: now,
    }

    await sadhanaDB.habitDefinitions.put(habit)
  },

  async delete(key: string): Promise<void> {
    await sadhanaDB.habitDefinitions.delete(key)
  },
}
