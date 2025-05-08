import { useState } from 'react'

import dayjs from 'dayjs'

import { useHabits } from '@/shared/api/hooks/useHabits'
import { useSleepRecords } from '@/shared/api/hooks/useSleepRecords'
import { TimePicker } from '@/shared/components/time-picker'
import { DurationPicker } from '@/shared/components/duration-picker'
import { Button } from '@/shared/components/ui/button'

const getLastNDays = (n = 7): string[] => {
  return Array.from({ length: n })
    .map((_, i) => dayjs().subtract(i, 'day').format('YYYY-MM-DD'))
    .reverse()
}

const MainPage = () => {
  const { habitsQuery, addHabit } = useHabits()
  const { sleepRecordsQuery, updateHabit, removeHabit } = useSleepRecords()

  const [newHabitLabel, setNewHabitLabel] = useState<string>('')

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
      <h2 className="text-xl font-medium mb-4">Трекер за последнюю неделю</h2>

      <table className="min-w-max border border-gray-300 text-sm text-center">
        <thead>
          <tr className="bg-gray-100">
            <th className="border px-1 py-1 text-left"></th>
            {days.map((date) => (
              <th key={date} className="border px-1 py-1 font-normal">
                {dayjs(date).format('DD.MM')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="border px-2 py-1 text-left">Отбой</td>
            {days.map((date) => {
              const entry = getEntryByDate(date)
              const bedtime = entry?.sleep?.bedtime

              const value = bedtime ? dayjs(bedtime).format('HH:mm') : null
              const defaultTime = '23:00'

              const handleChange = (newTime: string) => {
                const bed = dayjs(date)
                  .set('hour', Number(newTime.slice(0, 2)))
                  .set('minute', Number(newTime.slice(3, 5)))
                const wake = entry?.sleep?.wakeTime ? dayjs(entry.sleep.wakeTime) : null

                const adjustedBed =
                  wake && bed.isAfter(wake) ? bed.subtract(1, 'day') : bed

                const bedtimeIso = adjustedBed.toISOString()
                const wakeIso = wake?.toISOString() ?? null

                updateSleep.mutate({
                  id: date,
                  sleep: {
                    bedtime: bedtimeIso,
                    wakeTime: wakeIso,
                    napDurationMin: entry?.sleep?.napDurationMin ?? 0,
                  },
                })
              }

              return (
                <td key={date} className="border px-0 py-0">
                  <TimePicker
                    value={value}
                    defaultValue={defaultTime}
                    onChange={handleChange}
                  />
                </td>
              )
            })}
          </tr>

          <tr>
            <td className="border px-2 py-1 text-left">Подъём</td>
            {days.map((date) => {
              const entry = getEntryByDate(date)
              const current = entry?.sleep?.wakeTime
                ? dayjs(entry.sleep.wakeTime).format('HH:mm')
                : null

              const handleWakeChange = (newTime: string) => {
                const wake = dayjs(date)
                  .set('hour', Number(newTime.slice(0, 2)))
                  .set('minute', Number(newTime.slice(3, 5)))

                const bed = entry?.sleep?.bedtime ? dayjs(entry.sleep.bedtime) : null

                updateSleep.mutate({
                  id: date,
                  sleep: {
                    bedtime: bed?.toISOString() ?? null,
                    wakeTime: wake.toISOString(),
                    napDurationMin: entry?.sleep?.napDurationMin ?? 0,
                  },
                })
              }

              return (
                <td key={date} className="border px-0 py-0">
                  <TimePicker
                    value={current}
                    defaultValue="08:00"
                    onChange={handleWakeChange}
                  />
                </td>
              )
            })}
          </tr>

          <tr>
            <td className="border px-2 py-1 text-left">Дневной сон</td>
            {days.map((date) => {
              const entry = getEntryByDate(date)

              const napMin: number | null = entry?.sleep?.napDurationMin ?? null

              const napValue: string | null = napMin
                ? `${Math.floor(napMin / 60)}:${String(napMin % 60).padStart(2, '0')}`
                : null

              const handleDailySleepChange = (dur: string): void => {
                const [h, m] = dur.split(':').map(Number)
                const newNapMin = h * 60 + m
                updateSleep.mutate({
                  id: date,
                  sleep: {
                    bedtime: entry?.sleep?.bedtime ?? null,
                    wakeTime: entry?.sleep?.wakeTime ?? null,
                    napDurationMin: newNapMin,
                  },
                })
              }

              return (
                <td key={date} className="border px-0 py-0">
                  <DurationPicker
                    value={napValue}
                    defaultValue="0:15"
                    onChange={handleDailySleepChange}
                  />
                </td>
              )
            })}
          </tr>

          <tr>
            <td className="border px-2 py-1 text-left">Время сна</td>
            {days.map((date) => {
              const entry = getEntryByDate(date)
              const duration = entry?.sleep?.durationMin

              if (!duration) {
                return (
                  <td key={date} className="border px-1 py-1">
                    —
                  </td>
                )
              }

              const hours = Math.floor(duration / 60)
              const minutes = duration % 60

              return (
                <td key={date} className="border px-0 py-0">
                  {`${hours}:${String(minutes).padStart(2, '0')}`}
                </td>
              )
            })}
          </tr>

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
      <div className="mt-6 flex items-center space-x-2">
        {/* Инпут для названия */}
        <input
          type="text"
          placeholder="Новая привычка"
          value={newHabitLabel}
          onChange={(e) => setNewHabitLabel(e.target.value)} // обновляем стейт
          className="flex-1 rounded border px-3 py-2 focus:outline-none"
        />
        {/* Кнопка «Добавить» */}
        <Button
          onClick={() => {
            addHabit.mutate(newHabitLabel) // запускаем мутацию
            setNewHabitLabel('') // очищаем инпут
          }}
          disabled={!newHabitLabel.trim() || addHabit.isPending} // блокируем при пустом или загрузке
        >
          {addHabit.isPending ? 'Добавление...' : 'Добавить'}
        </Button>
      </div>
    </div>
  )
}

export const Component = MainPage
