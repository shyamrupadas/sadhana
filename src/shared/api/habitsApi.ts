import { HabitDefinition, sadhanaDB } from './db/sadhanaDB'

// 🔧 Утилита: генерация key из label (транслитерация + slugify)
function generateHabitKey(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-') // пробелы → дефисы
    .replace(/[^a-zа-яё0-9\-]/gi, '') // убрать спецсимволы
    .normalize('NFKD') // убрать диакритику
    .replace(/[\u0300-\u036f]/g, '')
}

export const habitApi = {
  // Получить все привычки
  async getAll(): Promise<HabitDefinition[]> {
    return await sadhanaDB.habitDefinitions.toArray()
  },

  // Добавить новую привычку (генерация key происходит внутри)
  async add(label: string): Promise<void> {
    const key = generateHabitKey(label)
    const now = new Date().toISOString()

    const existing = await sadhanaDB.habitDefinitions.get(key)
    if (existing) return // Не добавлять дубликат

    const habit: HabitDefinition = {
      key,
      label,
      createdAt: now,
    }

    await sadhanaDB.habitDefinitions.put(habit)
  },

  // Удалить привычку по ключу
  async delete(key: string): Promise<void> {
    await sadhanaDB.habitDefinitions.delete(key)
  },
}
