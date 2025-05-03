import Dexie, { Table } from 'dexie'

// Тип одной привычки (глобальный список)
export type HabitDefinition = {
  key: string // Уникальный ключ, например: 'workout'
  label: string // Отображаемое имя, например: 'Зарядка'
  createdAt: string // ISO-дата создания привычки
}

// Тип привычки, отмеченной в конкретный день
export type HabitCheck = {
  key: string
  value: boolean // true / false (null не используется)
}

// Данные сна в конкретный день
export type SleepData = {
  bedtime: string | null // ISO: '2025-05-02T23:30:00Z'
  wakeTime: string | null // ISO: '2025-05-03T07:20:00Z'
  napDurationMin: number // Длительность дневного сна в минутах
}

// Запись за день — привычки + сон
export type DailyEntry = {
  id: string // Уникальный ID = дата пробуждения (YYYY-MM-DD)
  date: string // дублируется для удобства
  sleep: SleepData
  habits: HabitCheck[]
}

// Dexie база
class SadhanaDatabase extends Dexie {
  sleepRecords!: Table<DailyEntry, string> // id = YYYY-MM-DD
  habitDefinitions!: Table<HabitDefinition, string> // key = habit.key

  constructor() {
    super('sadhanaDB')
    this.version(1).stores({
      sleepRecords: 'id, date', // Основной индекс: id (по дню)
      habitDefinitions: 'key', // Простой ключ по habit.key
    })
  }
}

export const sadhanaDB = new SadhanaDatabase()
