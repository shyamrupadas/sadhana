import { useState } from 'react'
import dayjs from 'dayjs'
import { PenIcon, XIcon } from 'lucide-react'

import { useHabits } from '@/features/main/model/use-habits'
import { useSleepRecords } from '@/features/main/model/use-sleep-records'
import { TimePicker } from '@/shared/components/time-picker'
import { DurationPicker } from '@/shared/components/duration-picker'
import { Button } from '@/shared/components/ui/button'
import { cn } from '@/shared/lib/utils'

const getLastNDays = (n = 5): string[] => {
  return Array.from({ length: n })
    .map((_, i) => dayjs().subtract(i, 'day').format('YYYY-MM-DD'))
    .reverse()
}

const LoadingScreen = () => (
  <main className="flex grow items-center justify-center motion-safe:animate-[fade-in_500ms_ease-in-out]">
    <img src="/check.svg" alt="Садхана" className="w-50 opacity-10 grayscale" />
  </main>
)

const MainPage = () => {
  const { habitsQuery, addHabit, deleteHabit, renameHabit } = useHabits()
  const { sleepRecordsQuery, updateSleep, updateHabit, removeHabit } = useSleepRecords()
  const [newHabitLabel, setNewHabitLabel] = useState<string>('')
  const [editMode, setEditMode] = useState<boolean>(false)

  const days = getLastNDays()
  const habits = habitsQuery.data ?? []
  const entries = sleepRecordsQuery.data ?? []

  const getEntryByDate = (date: string) => entries.find((e) => e.id === date)
  const normalizeNapDuration = (value?: number | null) =>
    value === 0 || value === undefined ? null : value

  if (habitsQuery.isError || sleepRecordsQuery.isError) {
    return (
      <main className="flex grow items-center justify-center p-4" role="alert">
        <p>Не удалось загрузить данные дня. Попробуйте открыть страницу позже.</p>
      </main>
    )
  }

  if (!habitsQuery.data || !sleepRecordsQuery.data) {
    return <LoadingScreen />
  }

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
    <main className="grow flex flex-col items-center motion-safe:animate-[fade-in_500ms_ease-in-out] will-change-[opacity,transform]">
      <div className="w-full max-w-100 p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-medium">Садхана</h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleEditModeToggle}
            className={cn(
              'text-gray-600 hover:text-gray-800',
              editMode &&
                'bg-red-100 text-red-700 hover:text-red-800 ring-1 ring-red-200'
            )}
            title={editMode ? 'Выйти из режима редактирования' : 'Режим редактирования'}
            aria-pressed={editMode}
          >
            <PenIcon className="h-4 w-4" />
          </Button>
        </div>

        <div className="overflow-x-auto min-w-0">
          <div className="w-full max-w-md mx-auto rounded-[4px] overflow-hidden border border-gray-200">
            <table className="table-fixed text-sm text-center w-full border-collapse [&_tr>th:first-child]:overflow-hidden [&_tr>td:first-child]:overflow-hidden [&_tr>th:first-child]:min-w-0 [&_tr>td:first-child]:min-w-0 [&_tr>th:not(:first-child)]:max-w-11 [&_tr>td:not(:first-child)]:max-w-11 [&_tr>th:not(:first-child)]:min-w-0 [&_tr>td:not(:first-child)]:min-w-0 [&_tr>th:first-child]:border-l-0 [&_tr>td:first-child]:border-l-0 [&_tr>th:last-child]:border-r-0 [&_tr>td:last-child]:border-r-0 [&_tr:first-child>th]:border-t-0 [&_tr:first-child>td]:border-t-0 [&_tbody>tr:last-child>td]:border-b-0">
              <colgroup>
                <col className="min-w-0" />
                {days.map((date) => (
                  <col key={date} className="w-[43px]" />
                ))}
              </colgroup>
              <thead>
                <tr className="h-9 bg-gray-100">
                  <th className="border px-1 text-left"></th>
                  {days.map((date) => (
                    <th key={date} className="border px-1 font-normal">
                      {dayjs(date).format('DD.MM')}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                <tr className="h-9">
                  <td className="border px-2 text-left">
                    <span className="block w-full truncate">Подъём</span>
                  </td>
                  {days.map((date) => {
                    const entry = getEntryByDate(date)
                    const current = entry?.sleep?.wakeTime
                      ? dayjs(entry.sleep.wakeTime, 'YYYY-MM-DD HH:mm').format('HH:mm')
                      : null

                    const handleWakeChange = (newTime: string) => {
                      const wake = dayjs(date)
                        .set('hour', Number(newTime.slice(0, 2)))
                        .set('minute', Number(newTime.slice(3, 5)))

                      const bed = entry?.sleep?.bedtime ?? null

                      updateSleep.mutate({
                        id: date,
                        sleep: {
                          bedtime: bed,
                          wakeTime: wake.format('YYYY-MM-DD HH:mm'),
                          napDuration: normalizeNapDuration(entry?.sleep?.napDuration),
                        },
                      })
                    }

                    return (
                      <td key={date} className="border px-0">
                        <TimePicker
                          value={current}
                          defaultValue="08:00"
                          onChange={handleWakeChange}
                          disabled={editMode}
                        />
                      </td>
                    )
                  })}
                </tr>

                <tr className="h-9">
                  <td className="border px-2 text-left">
                    <span className="block w-full truncate">Дневной сон</span>
                  </td>
                  {days.map((date) => {
                    const entry = getEntryByDate(date)

                    const napMin: number | null = normalizeNapDuration(
                      entry?.sleep?.napDuration
                    )

                    const napValue: string | null =
                      napMin === null
                        ? null
                        : `${Math.floor(napMin / 60)}:${String(napMin % 60).padStart(2, '0')}`

                    const handleDailySleepChange = (dur: string): void => {
                      const [h, m] = dur.split(':').map(Number)
                      const newNapMin = h * 60 + m
                      updateSleep.mutate({
                        id: date,
                        sleep: {
                          bedtime: entry?.sleep?.bedtime ?? null,
                          wakeTime: entry?.sleep?.wakeTime ?? null,
                          napDuration: newNapMin === 0 ? null : newNapMin,
                        },
                      })
                    }

                    return (
                      <td key={date} className="border px-0">
                        <DurationPicker
                          value={napValue}
                          defaultValue="0:15"
                          onChange={handleDailySleepChange}
                          disabled={editMode}
                        />
                      </td>
                    )
                  })}
                </tr>

                <tr className="h-9">
                  <td className="border px-2 text-left">
                    <span className="block w-full truncate">Сон (итого)</span>
                  </td>
                  {days.map((date) => {
                    const entry = getEntryByDate(date)
                    const duration = entry?.sleep?.duration

                    if (duration === null || duration === undefined) {
                      return (
                        <td key={date} className="border px-2">
                          —
                        </td>
                      )
                    }

                    const hours = Math.floor(duration / 60)
                    const minutes = duration % 60

                    return (
                      <td key={date} className="border px-2">
                        {`${hours}:${String(minutes).padStart(2, '0')}`}
                      </td>
                    )
                  })}
                </tr>

                <tr className="h-9">
                  <td className="border px-2 text-left">
                    <span className="block w-full truncate">Отбой</span>
                  </td>
                  {days.map((date) => {
                    const entry = getEntryByDate(date)
                    const bedtime = entry?.sleep?.bedtime

                    const value = bedtime
                      ? dayjs(bedtime, 'YYYY-MM-DD HH:mm').format('HH:mm')
                      : null
                    const defaultTime = '23:00'

                    const handleChange = (newTime: string) => {
                      const bed = dayjs(date)
                        .set('hour', Number(newTime.slice(0, 2)))
                        .set('minute', Number(newTime.slice(3, 5)))
                      const wake = entry?.sleep?.wakeTime
                        ? dayjs(entry.sleep.wakeTime, 'YYYY-MM-DD HH:mm')
                        : null

                      const adjustedBed =
                        wake && bed.isAfter(wake) ? bed.subtract(1, 'day') : bed

                      const bedtime = adjustedBed.format('YYYY-MM-DD HH:mm')
                      const wakeTime = entry?.sleep?.wakeTime ?? null

                      updateSleep.mutate({
                        id: date,
                        sleep: {
                          bedtime: bedtime,
                          wakeTime: wakeTime,
                          napDuration: normalizeNapDuration(entry?.sleep?.napDuration),
                        },
                      })
                    }

                    return (
                      <td key={date} className="border px-0">
                        <TimePicker
                          value={value}
                          defaultValue={defaultTime}
                          onChange={handleChange}
                          disabled={editMode}
                        />
                      </td>
                    )
                  })}
                </tr>

                {habits.map((habit) => (
                  <tr key={habit.key} className="h-9">
                    <td className="border px-2 text-left relative">
                      <span className="block w-full truncate">{habit.label}</span>
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
                        <td key={date} className="border px-2">
                          <button
                            onClick={() => {
                              if (!editMode) {
                                handleToggleHabit(date, habit.key, value)
                              }
                            }}
                            disabled={editMode}
                            className={cn(
                              'w-6 h-6 rounded border align-middle disabled:cursor-not-allowed disabled:opacity-50',
                              value === true
                                ? 'bg-green-400'
                                : value === false
                                  ? 'bg-red-400'
                                  : 'bg-gray-200'
                            )}
                            title={
                              editMode
                                ? 'Редактирование включено'
                                : value === true
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
        </div>

        {editMode && (
          <div className="mt-6 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
            <input
              type="text"
              placeholder="Новая привычка"
              value={newHabitLabel}
              onChange={(e) => setNewHabitLabel(e.target.value)}
              className="min-w-0 flex-1 rounded border px-3 py-2 focus:outline-none"
            />
            <Button
              onClick={() => {
                addHabit.mutate(newHabitLabel)
                setNewHabitLabel('')
              }}
              disabled={!newHabitLabel.trim() || addHabit.isPending}
              className="w-full sm:w-auto"
            >
              {addHabit.isPending ? 'Добавление...' : 'Добавить'}
            </Button>
          </div>
        )}
      </div>
    </main>
  )
}

export const Component = MainPage
