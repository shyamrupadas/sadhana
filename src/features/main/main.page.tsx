import { useState, useEffect } from 'react'
import dayjs from 'dayjs'
import { PenIcon, XIcon } from 'lucide-react'

import { useHabits } from '@/shared/api/hooks/useHabits'
import { useSleepRecords } from '@/shared/api/hooks/useSleepRecords'
import { TimePicker } from '@/shared/components/time-picker'
import { DurationPicker } from '@/shared/components/duration-picker'
import { Button } from '@/shared/components/ui/button'
import { sleepApi } from '@/shared/api/sleepApi'

const getLastNDays = (n = 5): string[] => {
  return Array.from({ length: n })
    .map((_, i) => dayjs().subtract(i, 'day').format('YYYY-MM-DD'))
    .reverse()
}

const REMINDER_TIME = 10

const MainPage = () => {
  const { habitsQuery, addHabit, deleteHabit, renameHabit } = useHabits()
  const { sleepRecordsQuery, updateHabit, removeHabit } = useSleepRecords()

  const [newHabitLabel, setNewHabitLabel] = useState<string>('')
  const [editMode, setEditMode] = useState<boolean>(false)

  const { updateSleep } = useSleepRecords()

  useEffect(() => {
    if ('Notification' in window && Notification.permission !== 'denied') {
      Notification.requestPermission()
    }

    const checkTime = () => {
      const now = dayjs().add(3, 'hour')
      let targetTime = now.hour(REMINDER_TIME).minute(0).second(0)

      if (now.isAfter(targetTime)) {
        targetTime = targetTime.add(1, 'day')
      }

      const msToNextCheck = targetTime.diff(now)

      const timer = setTimeout(async () => {
        const hasData = await sleepApi.checkYesterdaySleep()
        if (!hasData && 'serviceWorker' in navigator) {
          navigator.serviceWorker.ready.then((registration) => {
            registration.active?.postMessage({
              type: 'SHOW_NOTIFICATION',
              title: 'Садхана',
              body: 'Не забудьте отметить время отбоя и подъема за прошедшую ночь',
            })
          })
        }
      }, msToNextCheck)

      return timer
    }

    const initialTimer = checkTime()
    return () => clearTimeout(initialTimer)
  }, [])

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

  const handleEditModeToggle = () => {
    setEditMode(!editMode)
  }

  const handleDeleteHabit = (habitKey: string, habitLabel: string) => {
    const confirmed = window.confirm(`Удалить привычку "${habitLabel}"?`)
    if (confirmed) {
      deleteHabit.mutate(habitKey)
    }
  }

  const handleRenameHabit = (habitKey: string, habitLabel: string) => {
    const newLabel = window.prompt(`Переименовать привычку "${habitLabel}":`, habitLabel)
    if (newLabel && newLabel.trim() && newLabel.trim() !== habitLabel) {
      renameHabit.mutate({ key: habitKey, newLabel: newLabel.trim() })
    }
  }

  return (
    <div className="p-4 overflow-x-auto max-w-full">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-medium">Садхана</h2>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleEditModeToggle}
          className="text-gray-600 hover:text-gray-800"
        >
          <PenIcon className="h-4 w-4" />
        </Button>
      </div>

      <table className="min-w-max border border-gray-300 text-sm text-center w-full max-w-[400px]">
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
              <td className="border px-2 py-1 text-left relative">
                <span>{habit.label}</span>
                {editMode && (
                  <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1 bg-white/90 rounded px-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRenameHabit(habit.key, habit.label)}
                      className="h-6 w-6 text-gray-600 hover:text-blue-600"
                    >
                      <PenIcon className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDeleteHabit(habit.key, habit.label)}
                      className="h-6 w-6 text-gray-600 hover:text-red-600"
                    >
                      <XIcon className="h-3 w-3" />
                    </Button>
                  </div>
                )}
              </td>
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
        <input
          type="text"
          placeholder="Новая привычка"
          value={newHabitLabel}
          onChange={(e) => setNewHabitLabel(e.target.value)}
          className="flex-1 rounded border px-3 py-2 focus:outline-none"
        />
        <Button
          onClick={() => {
            addHabit.mutate(newHabitLabel)
            setNewHabitLabel('')
          }}
          disabled={!newHabitLabel.trim() || addHabit.isPending}
        >
          {addHabit.isPending ? 'Добавление...' : 'Добавить'}
        </Button>
      </div>
    </div>
  )
}

export const Component = MainPage
