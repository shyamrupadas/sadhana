import { sadhanaDB, DailyEntry, HabitDefinition } from './db/sadhanaDB'

export type ExportedData = {
  version: number
  exportDate: string
  sleepRecords: DailyEntry[]
  habitDefinitions: HabitDefinition[]
}

export const exportData = async (): Promise<ExportedData> => {
  const sleepRecords = await sadhanaDB.sleepRecords.toArray()
  const habitDefinitions = await sadhanaDB.habitDefinitions.toArray()

  return {
    version: 1,
    exportDate: new Date().toISOString(),
    sleepRecords,
    habitDefinitions,
  }
}

export const importData = async (data: ExportedData): Promise<void> => {
  await sadhanaDB.sleepRecords.clear()
  await sadhanaDB.habitDefinitions.clear()

  await sadhanaDB.sleepRecords.bulkPut(data.sleepRecords)
  await sadhanaDB.habitDefinitions.bulkPut(data.habitDefinitions)
}

