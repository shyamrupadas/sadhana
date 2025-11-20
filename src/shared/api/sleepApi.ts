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
    const bed = data.bedtime ? dayjs(data.bedtime, 'YYYY-MM-DD HH:mm') : null
    const wake = data.wakeTime ? dayjs(data.wakeTime, 'YYYY-MM-DD HH:mm') : null

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

  async getSleepStats(): Promise<{
    week: { bedtime: string | null; wakeTime: string | null; duration: string | null }
    month: { bedtime: string | null; wakeTime: string | null; duration: string | null }
    year: { bedtime: string | null; wakeTime: string | null; duration: string | null }
  }> {
    const getLast7Days = (): string[] => {
      return Array.from({ length: 7 }).map((_, i) =>
        dayjs().subtract(i, 'day').format('YYYY-MM-DD')
      )
    }

    const getLast30Days = (): string[] => {
      return Array.from({ length: 30 }).map((_, i) =>
        dayjs().subtract(i, 'day').format('YYYY-MM-DD')
      )
    }

    const getLastYearDates = (): string[] => {
      const startOfCurrentMonth = dayjs().startOf('month')
      const startDate = startOfCurrentMonth.subtract(12, 'month')
      const endDate = startOfCurrentMonth.subtract(1, 'day')

      const dates: string[] = []
      let current = startDate

      while (current.isBefore(endDate) || current.isSame(endDate)) {
        dates.push(current.format('YYYY-MM-DD'))
        current = current.add(1, 'day')
      }

      return dates
    }

    const calculateAverageTime = (times: string[]): string | null => {
      if (times.length === 0) return null

      let totalMinutes = 0
      times.forEach((time) => {
        const [hours, minutes] = time.split(':').map(Number)
        // Время отбоя может быть после полуночи - нужна корректировка
        const adjustedMinutes =
          hours < 12 ? (hours + 24) * 60 + minutes : hours * 60 + minutes
        totalMinutes += adjustedMinutes
      })

      const avgMinutes = Math.round(totalMinutes / times.length)
      const hours = Math.floor(avgMinutes / 60) % 24
      const mins = avgMinutes % 60

      return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
    }

    const calculateAverageDuration = (durations: number[]): string | null => {
      if (durations.length === 0) return null

      const avgMinutes = Math.round(
        durations.reduce((sum, dur) => sum + dur, 0) / durations.length
      )
      const hours = Math.floor(avgMinutes / 60)
      const mins = avgMinutes % 60

      return `${hours}:${String(mins).padStart(2, '0')}`
    }

    const getValidSleepData = async (dates: string[]) => {
      const entries = await Promise.all(
        dates.map((date) => sadhanaDB.sleepRecords.get(date))
      )

      return entries
        .filter(
          (entry): entry is DailyEntry =>
            !!entry?.sleep?.bedtime &&
            !!entry?.sleep?.wakeTime &&
            !!entry?.sleep?.durationMin
        )
        .map((entry) => ({
          bedtime: dayjs(entry.sleep.bedtime, 'YYYY-MM-DD HH:mm').format('HH:mm'),
          wakeTime: dayjs(entry.sleep.wakeTime, 'YYYY-MM-DD HH:mm').format('HH:mm'),
          duration: entry.sleep.durationMin,
        }))
    }

    const last7Days = getLast7Days()
    const last30Days = getLast30Days()
    const lastYearDates = getLastYearDates()

    const weekData = await getValidSleepData(last7Days)
    const monthData = await getValidSleepData(last30Days)
    const yearData = await getValidSleepData(lastYearDates)

    return {
      week: {
        bedtime: calculateAverageTime(weekData.map((d) => d.bedtime)),
        wakeTime: calculateAverageTime(weekData.map((d) => d.wakeTime)),
        duration: calculateAverageDuration(weekData.map((d) => d.duration)),
      },
      month: {
        bedtime: calculateAverageTime(monthData.map((d) => d.bedtime)),
        wakeTime: calculateAverageTime(monthData.map((d) => d.wakeTime)),
        duration: calculateAverageDuration(monthData.map((d) => d.duration)),
      },
      year: {
        bedtime: calculateAverageTime(yearData.map((d) => d.bedtime)),
        wakeTime: calculateAverageTime(yearData.map((d) => d.wakeTime)),
        duration: calculateAverageDuration(yearData.map((d) => d.duration)),
      },
    }
  },
}
