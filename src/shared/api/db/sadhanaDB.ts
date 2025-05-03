import Dexie, { Table } from 'dexie'

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
}

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
  }
}

export const sadhanaDB = new SadhanaDatabase()
