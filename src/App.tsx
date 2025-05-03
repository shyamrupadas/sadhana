import dayjs from 'dayjs'
import { useHabits } from './shared/api/hooks/useHabits'
import { useSleepRecords } from './shared/api/hooks/useSleepRecords'
import { TimePicker } from './components/ui/time-picker'

const getLastNDays = (n = 7): string[] => {
  return Array.from({ length: n })
    .map((_, i) => dayjs().subtract(i, 'day').format('YYYY-MM-DD'))
    .reverse()
}

const combineDateWithTime = (date: string, time: string): string => {
  const [hour, minute] = time.split(':').map(Number)
  const base = new Date(date)
  base.setHours(hour)
  base.setMinutes(minute)
  base.setSeconds(0)
  base.setMilliseconds(0)
  return base.toISOString()
}

export const App = () => {
  const { habitsQuery } = useHabits()
  const { sleepRecordsQuery, updateHabit, removeHabit } = useSleepRecords()

  const { updateSleep } = useSleepRecords()

  const days = getLastNDays()
  const habits = habitsQuery.data ?? []
  const entries = sleepRecordsQuery.data ?? []

  const getEntryByDate = (date: string) => entries.find((e) => e.id === date)

  const getHabitValue = (date: string, habitKey: string): boolean | null => {
    const entry = getEntryByDate(date)
    const habit = entry?.habits.find((h) => h.key === habitKey)
    return habit?.value ?? null
  }

  const handleToggleHabit = (date: string, habitKey: string, current: boolean | null) => {
    if (current === null) {
      updateHabit.mutate({ id: date, key: habitKey, value: true })
    } else if (current === true) {
      updateHabit.mutate({ id: date, key: habitKey, value: false })
    } else {
      removeHabit.mutate({ id: date, key: habitKey })
    }
  }

  return (
    <div className="p-4 overflow-x-auto max-w-full">
      <h2 className="text-xl font-bold mb-4">Трекер за последнюю неделю</h2>

      <table className="min-w-max border border-gray-300 text-sm text-center">
        <thead>
          <tr className="bg-gray-100">
            <th className="border px-2 py-1 text-left">Привычка</th>
            {days.map((date) => (
              <th key={date} className="border px-2 py-1">
                {dayjs(date).format('DD.MM')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* Сон: отбой */}
          <tr>
            <td className="border px-2 py-1 text-left font-medium">Отбой</td>
            {days.map((date) => {
              const entry = getEntryByDate(date)
              const bedtime = entry?.sleep?.bedtime

              const value = bedtime ? dayjs(bedtime).format('HH:mm') : null
              const defaultTime = '23:00'

              const handleChange = (newTime: string) => {
                const bedtimeIso = combineDateWithTime(
                  dayjs(date).subtract(1, 'day').format('YYYY-MM-DD'),
                  newTime
                )

                updateSleep.mutate({
                  id: date,
                  sleep: {
                    bedtime: bedtimeIso,
                    wakeTime: entry?.sleep?.wakeTime ?? null,
                    napDurationMin: entry?.sleep?.napDurationMin ?? 0,
                  },
                })
              }

              return (
                <td key={date} className="border px-2 py-1">
                  {value ? (
                    <TimePicker
                      value={value}
                      defaultValue={defaultTime}
                      onChange={handleChange}
                    />
                  ) : (
                    <TimePicker
                      value={null}
                      defaultValue={defaultTime}
                      onChange={handleChange}
                    />
                  )}
                </td>
              )
            })}
          </tr>
          {/* Сон: подъём */}
          <tr>
            <td className="border px-2 py-1 text-left font-medium">Подъём</td>
            {days.map((date) => {
              const entry = getEntryByDate(date)
              const wakeTime = entry?.sleep?.wakeTime
              const time = wakeTime
                ? new Date(wakeTime).toLocaleTimeString('ru-RU', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : '—'
              return (
                <td key={date} className="border px-2 py-1">
                  {time}
                </td>
              )
            })}
          </tr>

          {/* Сон: дневной сон */}
          <tr>
            <td className="border px-2 py-1 text-left font-medium">Дневной сон (мин)</td>
            {days.map((date) => {
              const entry = getEntryByDate(date)
              const value = entry?.sleep?.napDurationMin ?? null
              return (
                <td key={date} className="border px-2 py-1">
                  {value !== null ? value : '—'}
                </td>
              )
            })}
          </tr>

          {/* Сон: общее время сна */}
          <tr>
            <td className="border px-2 py-1 text-left font-medium">
              Общее время сна (мин)
            </td>
            {days.map((date) => {
              const entry = getEntryByDate(date)
              const sleep = entry?.sleep
              if (!sleep?.bedtime || !sleep?.wakeTime)
                return (
                  <td key={date} className="border px-2 py-1">
                    —
                  </td>
                )

              const bedtimeMs = new Date(sleep.bedtime).getTime()
              const wakeTimeMs = new Date(sleep.wakeTime).getTime()

              const totalMinutes = (wakeTimeMs - bedtimeMs) / 60000 + sleep.napDurationMin
              const hours = Math.floor(totalMinutes / 60)
              const minutes = Math.round(totalMinutes % 60)

              return (
                <td key={date} className="border px-2 py-1">
                  {`${hours}:${minutes}`}
                </td>
              )
            })}
          </tr>

          {/* Строки с привычками */}
          {habits.map((habit) => (
            <tr key={habit.key}>
              <td className="border px-2 py-1 text-left">{habit.label}</td>
              {days.map((date) => {
                const value = getHabitValue(date, habit.key)
                return (
                  <td key={date} className="border px-2 py-1">
                    <button
                      onClick={() => handleToggleHabit(date, habit.key, value)}
                      className={`w-6 h-6 rounded border ${
                        value === true
                          ? 'bg-green-400'
                          : value === false
                            ? 'bg-red-400'
                            : 'bg-gray-200'
                      }`}
                      title={
                        value === true
                          ? 'Выполнено'
                          : value === false
                            ? 'Не выполнено'
                            : 'Не отмечено'
                      }
                    />
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
