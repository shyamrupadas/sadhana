import Dexie, { Table } from 'dexie'
import dayjs from 'dayjs'

export type HabitDefinition = {
  key: string
  label: string
  createdAt: string
}

export type HabitCheck = {
  key: string
  value: boolean
}

export type SleepData = {
  bedtime: string | null
  wakeTime: string | null
  napDurationMin: number
  durationMin: number
}

export type SleepDataInput = Omit<SleepData, 'durationMin'>

export type DailyEntry = {
  id: string
  date: string
  sleep: SleepData
  habits: HabitCheck[]
}

class SadhanaDatabase extends Dexie {
  sleepRecords!: Table<DailyEntry, string>
  habitDefinitions!: Table<HabitDefinition, string>

  constructor() {
    super('sadhanaDB')
    this.version(1).stores({
      sleepRecords: 'id, date',
      habitDefinitions: 'key',
    })

    this.version(2)
      .stores({
        sleepRecords: 'id, date, durationMin',
        habitDefinitions: 'key',
      })
      .upgrade((tx) => {
        return tx
          .table<DailyEntry>('sleepRecords')
          .toCollection()
          .modify((entry: DailyEntry) => {
            const bed = entry.sleep.bedtime ? dayjs(entry.sleep.bedtime) : null
            const wake = entry.sleep.wakeTime ? dayjs(entry.sleep.wakeTime) : null
            entry.sleep.durationMin =
              bed && wake
                ? wake.diff(bed, 'minute') + entry.sleep.napDurationMin
                : entry.sleep.napDurationMin
          })
      })

    this.version(3)
      .stores({
        sleepRecords: 'id, date, durationMin',
        habitDefinitions: 'key',
      })
      .upgrade((tx) => {
        return tx
          .table<DailyEntry>('sleepRecords')
          .toCollection()
          .modify((entry: DailyEntry) => {
            if (entry.sleep.bedtime && entry.sleep.bedtime.includes('T')) {
              const date = new Date(entry.sleep.bedtime)
              const adjustedMs = date.getTime() + 3 * 60 * 60 * 1000
              const adjusted = new Date(adjustedMs)

              const year = adjusted.getUTCFullYear()
              const month = String(adjusted.getUTCMonth() + 1).padStart(2, '0')
              const day = String(adjusted.getUTCDate()).padStart(2, '0')
              const hours = String(adjusted.getUTCHours()).padStart(2, '0')
              const minutes = String(adjusted.getUTCMinutes()).padStart(2, '0')

              entry.sleep.bedtime = `${year}-${month}-${day} ${hours}:${minutes}`
            }

            if (entry.sleep.wakeTime && entry.sleep.wakeTime.includes('T')) {
              const date = new Date(entry.sleep.wakeTime)
              const adjustedMs = date.getTime() + 3 * 60 * 60 * 1000
              const adjusted = new Date(adjustedMs)

              const year = adjusted.getUTCFullYear()
              const month = String(adjusted.getUTCMonth() + 1).padStart(2, '0')
              const day = String(adjusted.getUTCDate()).padStart(2, '0')
              const hours = String(adjusted.getUTCHours()).padStart(2, '0')
              const minutes = String(adjusted.getUTCMinutes()).padStart(2, '0')

              entry.sleep.wakeTime = `${year}-${month}-${day} ${hours}:${minutes}`
            }
          })
      })
  }
}

export const sadhanaDB = new SadhanaDatabase()
