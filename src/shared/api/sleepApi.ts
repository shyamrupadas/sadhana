import { DailyEntry, sadhanaDB, SleepData } from './db/sadhanaDB'

export const sleepApi = {
  async getAll(): Promise<DailyEntry[]> {
    return await sadhanaDB.sleepRecords.toArray()
  },

  async getById(id: string): Promise<DailyEntry | undefined> {
    return await sadhanaDB.sleepRecords.get(id)
  },

  async updateSleepForDay(id: string, data: SleepData): Promise<void> {
    const entry = await sadhanaDB.sleepRecords.get(id)

    const updated: DailyEntry = {
      id,
      date: id,
      sleep: data,
      habits: entry?.habits ?? [],
    }

    await sadhanaDB.sleepRecords.put(updated)
  },

  async updateHabitForDay(id: string, habitKey: string, value: boolean): Promise<void> {
    const entry = await sadhanaDB.sleepRecords.get(id)

    const habits = [...(entry?.habits ?? [])]
    const index = habits.findIndex((h) => h.key === habitKey)

    if (index !== -1) {
      habits[index].value = value
    } else {
      habits.push({ key: habitKey, value })
    }

    const updated: DailyEntry = {
      id,
      date: id,
      sleep: entry?.sleep ?? { bedtime: null, wakeTime: null, napDurationMin: 0 },
      habits,
    }

    await sadhanaDB.sleepRecords.put(updated)
  },

  async removeHabitForDay(id: string, habitKey: string): Promise<void> {
    const entry = await sadhanaDB.sleepRecords.get(id)
    if (!entry) return

    const habits = entry.habits.filter((h) => h.key !== habitKey)

    const updated: DailyEntry = {
      ...entry,
      habits,
    }

    await sadhanaDB.sleepRecords.put(updated)
  },
}
