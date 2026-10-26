import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import dayjs from 'dayjs'
import { useSession } from '@/shared/model/session'
import { Button } from '@/shared/components/ui/button'
import { useStatistics } from '@/features/statistics/model/use-statistics'
import {
  formatMinutes,
  movePeriod,
  periodDistance,
  periodLabel,
  periodStart,
  scales,
  type Granularity,
} from '@/features/statistics/model/calendar'

const rows = [
  ['wakeTime', 'Подъём'],
  ['nap', 'Дневной сон'],
  ['duration', 'Сон (итого)'],
  ['bedtime', 'Отбой'],
] as const

function StatisticsTable({ userId, asOfDate }: { userId: string; asOfDate: string }) {
  const [granularity, setGranularity] = useState<Granularity>('day')
  const [anchor, setAnchor] = useState(asOfDate)
  const [loadAnchor, setLoadAnchor] = useState(asOfDate)
  const [viewport, setViewport] = useState({ left: 0, width: 600, rem: 16 })
  const scroll = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; left: number } | null>(null)
  const pendingPosition = useRef(true)
  const { ranges, queries, firstPeriod, count, historyFrom } = useStatistics(
    userId,
    granularity,
    asOfDate,
    loadAnchor
  )
  const columnWidth = 3 * viewport.rem
  const labelWidth = 5.5 * viewport.rem
  const visibleWidth = Math.max(columnWidth, viewport.width - labelWidth)
  const firstVisible = Math.max(0, Math.floor(viewport.left / columnWidth))
  const lastVisible = Math.min(
    count - 1,
    Math.ceil((viewport.left + visibleWidth) / columnWidth) - 1
  )
  const start = Math.max(0, firstVisible - 3)
  const stop = Math.min(count, lastVisible + 4)
  const indices = Array.from(
    { length: Math.max(0, stop - start) },
    (_, index) => index + start
  )
  const columns = new Map(
    queries
      .flatMap((query) => query.data?.columns ?? [])
      .map((column) => [column.from, column])
  )
  const loadedRanges = queries.flatMap((query, index) =>
    query.data ? [ranges[index]] : []
  )

  const updateViewport = () => {
    const element = scroll.current
    if (!element) return
    const rem =
      Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
    setViewport({ left: element.scrollLeft, width: element.clientWidth || 600, rem })
  }
  useLayoutEffect(() => {
    const element = scroll.current
    if (!element) return
    updateViewport()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(updateViewport)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const previousScale = useRef<{
    key: string
    first: string
    granularity: Granularity
    width: number
  } | null>(null)
  useLayoutEffect(() => {
    const element = scroll.current
    if (!element) return
    // The scale can change the region width before ResizeObserver reports it.
    const width = element.clientWidth || viewport.width
    const rem =
      Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
    const measuredColumnWidth = 3 * rem
    const measuredVisibleWidth = Math.max(measuredColumnWidth, width - 5.5 * rem)
    const scale = `${granularity}:${firstPeriod}:${count}:${width}`
    if (previousScale.current?.key !== scale || pendingPosition.current) {
      const index = Math.max(
        0,
        Math.min(
          count - 1,
          periodDistance(firstPeriod, periodStart(anchor, granularity), granularity)
        )
      )
      if (
        previousScale.current?.granularity === granularity &&
        previousScale.current.width === width &&
        !pendingPosition.current
      ) {
        element.scrollLeft +=
          periodDistance(firstPeriod, previousScale.current.first, granularity) *
          measuredColumnWidth
      } else {
        element.scrollLeft = Math.max(
          0,
          (index + 1) * measuredColumnWidth - measuredVisibleWidth
        )
      }
      previousScale.current = { key: scale, first: firstPeriod, granularity, width }
      pendingPosition.current = false
      updateViewport()
      const first = Math.floor(element.scrollLeft / measuredColumnWidth)
      const last = Math.min(
        count - 1,
        Math.ceil((element.scrollLeft + measuredVisibleWidth) / measuredColumnWidth) - 1
      )
      setLoadAnchor(movePeriod(firstPeriod, Math.floor((first + last) / 2), granularity))
    }
  }, [granularity, firstPeriod, count, anchor, columnWidth, visibleWidth, viewport.width])

  const onScroll = () => {
    const element = scroll.current!
    let left = element.scrollLeft
    if (loadedRanges.length) {
      const lower = loadedRanges.map((range) => range.from).sort()[0]
      const upper = loadedRanges
        .map((range) => range.toExclusive)
        .sort()
        .at(-1)!
      // A large placeholder is reachable on each side; movement beyond it waits for data.
      const min = Math.max(
        0,
        periodDistance(firstPeriod, lower, granularity) * columnWidth - visibleWidth
      )
      const max = Math.min(
        Math.max(0, count * columnWidth - visibleWidth),
        periodDistance(firstPeriod, upper, granularity) * columnWidth
      )
      left = Math.max(min, Math.min(max, left))
      element.scrollLeft = left
    }
    const first = Math.floor(left / columnWidth)
    const last = Math.min(count - 1, Math.ceil((left + visibleWidth) / columnWidth) - 1)
    setLoadAnchor(movePeriod(firstPeriod, Math.floor((first + last) / 2), granularity))
    const anchorIndex = periodDistance(
      firstPeriod,
      periodStart(anchor, granularity),
      granularity
    )
    if (anchorIndex < first || anchorIndex > last)
      setAnchor(movePeriod(firstPeriod, last, granularity))
    updateViewport()
  }

  const missing = indices.filter(
    (index) => !columns.has(movePeriod(firstPeriod, index, granularity))
  )
  const missingGroups: number[][] = []
  for (const index of missing) {
    const last = missingGroups.at(-1)
    if (last?.at(-1) === index - 1) last.push(index)
    else missingGroups.push([index])
  }

  return (
    <main className="min-w-0 grow p-3">
      <div className="mx-auto max-w-5xl space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="flex flex-wrap gap-1"
            role="group"
            aria-label="Масштаб статистики"
          >
            {scales.map(([value, label]) => (
              <Button
                key={value}
                size="sm"
                variant={granularity === value ? 'default' : 'outline'}
                aria-pressed={granularity === value}
                onClick={() => {
                  pendingPosition.current = true
                  setLoadAnchor(anchor)
                  setGranularity(value)
                }}
              >
                {label}
              </Button>
            ))}
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              pendingPosition.current = true
              setAnchor(asOfDate)
              setLoadAnchor(asOfDate)
              if (scroll.current) {
                scroll.current.scrollLeft = count * columnWidth
                updateViewport()
              }
            }}
          >
            К сегодня
          </Button>
        </div>
        <div
          ref={scroll}
          role="region"
          aria-label="История сна"
          tabIndex={0}
          className={`relative overflow-x-auto overscroll-x-contain rounded border focus-visible:outline-2 ${granularity === 'year' ? 'max-w-118' : 'max-w-full'}`}
          onScroll={onScroll}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault()
              scroll.current!.scrollLeft +=
                event.key === 'ArrowLeft' ? -columnWidth : columnWidth
              onScroll()
            }
          }}
          onPointerDown={(event) => {
            if (
              event.pointerType === 'mouse' &&
              event.button === 0 &&
              !(event.target as HTMLElement).closest('button')
            ) {
              drag.current = { x: event.clientX, left: event.currentTarget.scrollLeft }
              event.currentTarget.setPointerCapture(event.pointerId)
            }
          }}
          onPointerMove={(event) => {
            if (drag.current) {
              event.currentTarget.scrollLeft =
                drag.current.left + drag.current.x - event.clientX
              onScroll()
            }
          }}
          onPointerUp={() => {
            drag.current = null
          }}
          onPointerCancel={() => {
            drag.current = null
          }}
        >
          <div
            role="table"
            aria-label="Статистика сна"
            aria-colcount={count + 1}
            className="relative text-xs select-none"
            style={{ width: `${5.5 + count * 3}rem`, minWidth: '100%' }}
          >
            <div role="row" className="relative h-12 bg-gray-100">
              <div
                role="columnheader"
                className="sticky left-0 z-20 h-full w-22 border-r border-b bg-gray-100"
              />
              {indices
                .filter((index) =>
                  columns.has(movePeriod(firstPeriod, index, granularity))
                )
                .map((index) => {
                  const date = movePeriod(firstPeriod, index, granularity)
                  return (
                    <div
                      role="columnheader"
                      aria-colindex={index + 2}
                      key={date}
                      className="absolute top-0 flex h-full w-12 items-center justify-center border-r border-b"
                      style={{ left: `${5.5 + index * 3}rem` }}
                    >
                      <button
                        className="h-full w-full"
                        aria-label={date}
                        onClick={() => setAnchor([date, asOfDate].sort()[0])}
                      >
                        {periodLabel(date, granularity)}
                      </button>
                    </div>
                  )
                })}
            </div>
            {rows.map(([key, label]) => (
              <div role="row" key={key} className="relative h-10">
                <div
                  role="rowheader"
                  className="sticky left-0 z-20 flex h-full w-22 items-center border-r border-b bg-background px-1"
                >
                  {label}
                </div>
                {indices
                  .filter((index) =>
                    columns.has(movePeriod(firstPeriod, index, granularity))
                  )
                  .map((index) => {
                    const date = movePeriod(firstPeriod, index, granularity)
                    const column = columns.get(date)!
                    return (
                      <div
                        role="cell"
                        aria-colindex={index + 2}
                        key={date}
                        className="absolute top-0 flex h-full w-12 items-center justify-center border-r border-b"
                        style={{ left: `${5.5 + index * 3}rem` }}
                      >
                        {formatMinutes(
                          key === 'nap' && column.nap.sum === 0
                            ? null
                            : column[key].value,
                          key === 'bedtime' || key === 'wakeTime'
                        )}
                      </div>
                    )
                  })}
              </div>
            ))}
            {missingGroups.map((group) => {
              const from = movePeriod(firstPeriod, group[0], granularity)
              const to = movePeriod(firstPeriod, group.at(-1)! + 1, granularity)
              const affected = queries.filter(
                (_, index) => ranges[index].from < to && ranges[index].toExclusive > from
              )
              const failed = affected.some((query) => query.isError)
              return (
                <div
                  key={from}
                  role={failed ? 'alert' : 'status'}
                  className="absolute inset-y-0 flex flex-col items-center justify-center gap-2 bg-muted/70 p-2 text-center"
                  style={{
                    left: `${5.5 + group[0] * 3}rem`,
                    width: `${group.length * 3}rem`,
                  }}
                >
                  {failed ? (
                    <>
                      <span>Не удалось загрузить историю</span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => affected.forEach((query) => void query.refetch())}
                      >
                        Повторить
                      </Button>
                    </>
                  ) : (
                    'Загрузка…'
                  )}
                </div>
              )
            })}
          </div>
        </div>
        {!historyFrom && !queries.some((query) => query.isError) && (
          <p role="status">Загрузка статистики…</p>
        )}
      </div>
    </main>
  )
}

function StatisticsPage() {
  const { session } = useSession()
  const [today, setToday] = useState(() => dayjs().format('YYYY-MM-DD'))
  useEffect(() => {
    const update = () => setToday(dayjs().format('YYYY-MM-DD'))
    const timer = window.setInterval(update, 30_000)
    window.addEventListener('focus', update)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', update)
    }
  }, [])
  return (
    <StatisticsTable
      key={`${session?.userId}:${today}`}
      userId={session?.userId ?? ''}
      asOfDate={today}
    />
  )
}

export const Component = StatisticsPage
