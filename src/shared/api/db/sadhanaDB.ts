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
  }
}

export const sadhanaDB = new SadhanaDatabase()
