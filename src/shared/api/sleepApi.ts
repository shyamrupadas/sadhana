import dayjs from 'dayjs'
import { DailyEntry, sadhanaDB, SleepData } from './db/sadhanaDB'

export const sleepApi = {
  async checkYesterdaySleep(): Promise<boolean> {
    // Moscow time is UTC+3, calculate yesterday's date in MSK
    // Calculate yesterday's date in Moscow time (UTC+3)
    const yesterday = dayjs().add(3, 'hour').subtract(1, 'day').format('YYYY-MM-DD')
    const entry = await sadhanaDB.sleepRecords.get(yesterday)
    return !!entry?.sleep?.bedtime && !!entry?.sleep?.wakeTime
  },

  async getAll(): Promise<DailyEntry[]> {
    return await sadhanaDB.sleepRecords.toArray()
  },

  async getById(id: string): Promise<DailyEntry | undefined> {
    return await sadhanaDB.sleepRecords.get(id)
  },
  async updateSleepForDay(
    id: string,
    data: Omit<SleepData, 'durationMin'>
  ): Promise<void> {
    const bed = data.bedtime ? dayjs(data.bedtime) : null
    const wake = data.wakeTime ? dayjs(data.wakeTime) : null

    const diff = bed && wake ? wake.diff(bed, 'minute') : 0
    const nightMinutes = diff >= 0 ? diff : diff + 24 * 60

    const durationMin = data.napDurationMin + nightMinutes

    const sleep: SleepData = { ...data, durationMin }

    const entry = await sadhanaDB.sleepRecords.get(id)
    const updated: DailyEntry = {
      id,
      date: id,
      sleep,
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
      sleep: entry?.sleep ?? {
        bedtime: null,
        wakeTime: null,
        napDurationMin: 0,
        durationMin: 0,
      },
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
