import { ArrowUp, ArrowDown } from 'lucide-react'

import { useSleepStats } from './model/use-sleep-stats'

const shouldShowArrow = (current: string, previous: string, color: string) => {
  const isPlaceholder = (value: string) => value === '' || value === '—'
  if (isPlaceholder(current) || isPlaceholder(previous)) return false
  if (current === previous) return false
  if (color.includes('gray')) return false
  return true
}

const StatisticsPage = () => {
  const { sleepStatsQuery } = useSleepStats()
  const sleepStats = sleepStatsQuery.data

  if (sleepStatsQuery.isLoading) {
    return (
      <main className="flex grow items-center justify-center p-4" aria-live="polite">
        <p>Загрузка статистики сна…</p>
      </main>
    )
  }

  if (sleepStatsQuery.isError) {
    return (
      <main className="flex grow items-center justify-center p-4" role="alert">
        <p>Не удалось загрузить статистику сна. Попробуйте открыть страницу позже.</p>
      </main>
    )
  }

  return (
    <main className="flex grow flex-col items-center motion-safe:animate-[fade-in_500ms_ease-in-out] will-change-[opacity,transform]">
      <div className="w-full max-w-100 p-4">
        <div>
          <div className="mb-4 flex h-9 items-center">
            <h1 className="text-xl font-medium">Статистика</h1>
          </div>
          <div className="w-full max-w-md mx-auto rounded overflow-hidden border border-gray-200">
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

export const Component = StatisticsPage
