import { useState } from 'react'
import dayjs from 'dayjs'
import { PenIcon, XIcon, ArrowUp, ArrowDown, User, LogOut } from 'lucide-react'

import { useHabits } from '@/features/main/model/use-habits'
import { useSleepRecords } from '@/features/main/model/use-sleep-records'
import { useSleepStats } from '@/features/main/model/use-sleep-stats'
import { TimePicker } from '@/shared/components/time-picker'
import { DurationPicker } from '@/shared/components/duration-picker'
import { Button } from '@/shared/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/components/ui/popover'
import { useSession } from '@/shared/model/session'
import { cn } from '@/shared/lib/utils'

const getLastNDays = (n = 5): string[] => {
  return Array.from({ length: n })
    .map((_, i) => dayjs().subtract(i, 'day').format('YYYY-MM-DD'))
    .reverse()
}

const LoadingScreen = () => {
  return (
    <main className="grow flex items-center justify-center motion-safe:animate-[fade-in_500ms_ease-in-out] will-change-[opacity,transform]">
      <img src="/check.svg" alt="Садхана" className="w-[200px] opacity-10 grayscale" />
    </main>
  )
}

const MainPage = () => {
  const { habitsQuery, addHabit, deleteHabit, renameHabit } = useHabits()
  const { sleepRecordsQuery, updateSleep, updateHabit, removeHabit } = useSleepRecords()
  const { sleepStatsQuery } = useSleepStats()
  const { logout, session } = useSession()
  const email = session?.email ?? ''

  const [newHabitLabel, setNewHabitLabel] = useState<string>('')
  const [editMode, setEditMode] = useState<boolean>(false)

  const days = getLastNDays()
  const habits = habitsQuery.data ?? []
  const entries = sleepRecordsQuery.data ?? []

  const getEntryByDate = (date: string) => entries.find((e) => e.id === date)
  const normalizeNapDuration = (value?: number | null) =>
    value === 0 || value === undefined ? null : value

  const sleepStats = sleepStatsQuery.data

  if (sleepStatsQuery.isLoading || !sleepStats) {
    return <LoadingScreen />
  }

  const isPlaceholder = (value?: string | null) =>
    value === null || value === undefined || value === '' || value === '—'

  const shouldShowArrow = (current: string, previous: string, color: string) => {
    if (isPlaceholder(current) || isPlaceholder(previous)) return false
    if (current === previous) return false
    if (color.includes('gray')) return false
    return true
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
          <div className="flex flex-row">
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
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" title="Аккаунт">
                  <User className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-48 p-1 md:p-2">
                <div className="flex flex-col gap-2">
                  <Button variant="ghost" className="justify-start gap-2 px-2" disabled>
                    <User className="h-4 w-4" />
                    <span className="truncate">{email}</span>
                  </Button>
                  <Button
                    variant="ghost"
                    className="justify-start gap-2 px-2"
                    onClick={logout}
                  >
                    <LogOut className="h-4 w-4" />
                    Выйти
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          </div>
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

        <div className="mt-8 mb-6">
          <h3 className="text-lg font-medium mb-3">Статистика</h3>
          <div className="w-full max-w-md mx-auto rounded-[4px] overflow-hidden border border-gray-200">
            <table className="text-sm w-full border-collapse [&_tr>th:first-child]:max-w-28 [&_tr>td:first-child]:max-w-28 [&_tr>th:first-child]:border-l-0 [&_tr>td:first-child]:border-l-0 [&_tr>th:last-child]:border-r-0 [&_tr>td:last-child]:border-r-0 [&_tr:first-child>th]:border-t-0 [&_tr:first-child>td]:border-t-0 [&_tbody>tr:last-child>td]:border-b-0">
              <thead>
                <tr className="h-9 bg-gray-100">
                  <th className="border px-3 text-left font-normal"></th>
                  <th className="border px-3 text-center font-normal">Год</th>
                  <th className="border px-3 text-center font-normal">30 дней</th>
                  <th className="border px-3 text-center font-normal">7 дней</th>
                </tr>
              </thead>
              <tbody>
                <tr className="h-9">
                  <td className="border px-3">
                    <span className="block w-full truncate">Отбой</span>
                  </td>
                  <td className="border px-3 text-center">{sleepStats.bedtime.year}</td>
                  <td className="border px-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <span>{sleepStats.bedtime.month}</span>
                      {shouldShowArrow(
                        sleepStats.bedtime.month,
                        sleepStats.bedtime.year,
                        sleepStats.bedtime.monthColor
                      ) &&
                        (sleepStats.bedtime.monthArrow === ArrowDown ? (
                          <ArrowDown
                            className={`h-3 w-3 ${sleepStats.bedtime.monthColor}`}
                          />
                        ) : (
                          <ArrowUp
                            className={`h-3 w-3 ${sleepStats.bedtime.monthColor}`}
                          />
                        ))}
                    </div>
                  </td>
                  <td className="border px-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <span>{sleepStats.bedtime.week}</span>
                      {shouldShowArrow(
                        sleepStats.bedtime.week,
                        sleepStats.bedtime.month,
                        sleepStats.bedtime.weekColor
                      ) &&
                        (sleepStats.bedtime.weekArrow === ArrowDown ? (
                          <ArrowDown
                            className={`h-3 w-3 ${sleepStats.bedtime.weekColor}`}
                          />
                        ) : (
                          <ArrowUp
                            className={`h-3 w-3 ${sleepStats.bedtime.weekColor}`}
                          />
                        ))}
                    </div>
                  </td>
                </tr>
                <tr className="h-9">
                  <td className="border px-3">
                    <span className="block w-full truncate">Подъем</span>
                  </td>
                  <td className="border px-3 text-center">{sleepStats.wakeTime.year}</td>
                  <td className="border px-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <span>{sleepStats.wakeTime.month}</span>
                      {shouldShowArrow(
                        sleepStats.wakeTime.month,
                        sleepStats.wakeTime.year,
                        sleepStats.wakeTime.monthColor
                      ) &&
                        (sleepStats.wakeTime.monthArrow === ArrowDown ? (
                          <ArrowDown
                            className={`h-3 w-3 ${sleepStats.wakeTime.monthColor}`}
                          />
                        ) : (
                          <ArrowUp
                            className={`h-3 w-3 ${sleepStats.wakeTime.monthColor}`}
                          />
                        ))}
                    </div>
                  </td>
                  <td className="border px-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <span>{sleepStats.wakeTime.week}</span>
                      {shouldShowArrow(
                        sleepStats.wakeTime.week,
                        sleepStats.wakeTime.month,
                        sleepStats.wakeTime.weekColor
                      ) &&
                        (sleepStats.wakeTime.weekArrow === ArrowDown ? (
                          <ArrowDown
                            className={`h-3 w-3 ${sleepStats.wakeTime.weekColor}`}
                          />
                        ) : (
                          <ArrowUp
                            className={`h-3 w-3 ${sleepStats.wakeTime.weekColor}`}
                          />
                        ))}
                    </div>
                  </td>
                </tr>
                <tr className="h-9">
                  <td className="border px-3">
                    <span className="block w-full truncate">Сон</span>
                  </td>
                  <td className="border px-3 text-center">{sleepStats.sleep.year}</td>
                  <td className="border px-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <span>{sleepStats.sleep.month}</span>
                      {shouldShowArrow(
                        sleepStats.sleep.month,
                        sleepStats.sleep.year,
                        sleepStats.sleep.monthColor
                      ) &&
                        (sleepStats.sleep.monthArrow === ArrowDown ? (
                          <ArrowDown
                            className={`h-3 w-3 ${sleepStats.sleep.monthColor}`}
                          />
                        ) : (
                          <ArrowUp className={`h-3 w-3 ${sleepStats.sleep.monthColor}`} />
                        ))}
                    </div>
                  </td>
                  <td className="border px-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <span>{sleepStats.sleep.week}</span>
                      {shouldShowArrow(
                        sleepStats.sleep.week,
                        sleepStats.sleep.month,
                        sleepStats.sleep.weekColor
                      ) &&
                        (sleepStats.sleep.weekArrow === ArrowDown ? (
                          <ArrowDown
                            className={`h-3 w-3 ${sleepStats.sleep.weekColor}`}
                          />
                        ) : (
                          <ArrowUp className={`h-3 w-3 ${sleepStats.sleep.weekColor}`} />
                        ))}
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  )
}

export const Component = MainPage
