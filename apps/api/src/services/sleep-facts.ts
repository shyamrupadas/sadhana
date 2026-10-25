import type { ApiSchemas } from '@sadhana/api-contract'

// Format in SQL: pg's default timestamp parser applies the process timezone.
export const sleepProjection = `s.date::text AS date,
  to_char(s.bedtime, 'YYYY-MM-DD HH24:MI') AS bedtime,
  to_char(s.wake_time, 'YYYY-MM-DD HH24:MI') AS wake_time,
  s.nap_minutes`

export type SleepFact = {
  date: string
  bedtime: string | null
  wake_time: string | null
  nap_minutes: number | null
}

export function sleepForDay(
  current: SleepFact | undefined,
  previous: SleepFact | undefined
): ApiSchemas['SleepData'] {
  let duration: number | null = null
  if (previous?.bedtime && current?.wake_time) {
    const difference =
      (+new Date(current.wake_time.replace(' ', 'T') + 'Z') -
        +new Date(previous.bedtime.replace(' ', 'T') + 'Z')) /
      60000
    // Preserve the daily entry's existing duration semantics, using local wall clocks.
    const night = difference < 0 ? difference + 1440 : difference
    const total = night + (current.nap_minutes ?? 0)
    duration = Math.max(0, Math.min(1440, total > 1440 ? total - 1440 : total))
  }
  return {
    bedtime: current?.bedtime ?? null,
    wakeTime: current?.wake_time ?? null,
    napDuration: current?.nap_minutes ?? null,
    duration,
  }
}
