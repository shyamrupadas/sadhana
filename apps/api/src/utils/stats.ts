export function calculateAverageTime(times: string[]): string | null {
  if (times.length === 0) return null

  let totalMinutes = 0
  times.forEach((time) => {
    const [hours, minutes] = time.split(':').map(Number)
    const adjustedMinutes =
      hours < 12 ? (hours + 24) * 60 + minutes : hours * 60 + minutes
    totalMinutes += adjustedMinutes
  })

  const avgMinutes = Math.round(totalMinutes / times.length)
  const hours = Math.floor(avgMinutes / 60) % 24
  const mins = avgMinutes % 60

  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
}

export function calculateAverageDuration(durations: number[]): string | null {
  if (durations.length === 0) return null

  const avgMinutes = Math.round(
    durations.reduce((sum, dur) => sum + dur, 0) / durations.length
  )
  const hours = Math.floor(avgMinutes / 60)
  const mins = avgMinutes % 60

  return `${hours}:${String(mins).padStart(2, '0')}`
}
