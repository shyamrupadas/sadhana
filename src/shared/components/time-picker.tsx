import { useState, useMemo, useRef } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/components/ui/popover'
import { ScrollArea } from '@/shared/components/ui/scroll-area'
import { Button } from './ui/button'
import { cn } from '@/shared/lib/utils'

type TimePickerProps = {
  value: string | null
  defaultValue: string
  onChange: (val: string) => void
}

export const TimePicker = ({ value, defaultValue, onChange }: TimePickerProps) => {
  const [open, setOpen] = useState(false)

  const baseOptions = useMemo(() => {
    const arr: string[] = []
    for (let h = 0; h < 24; h++) {
      for (let m = 0; m < 60; m += 15) {
        arr.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
      }
    }
    return arr
  }, [])

  const options = useMemo(
    () => [...baseOptions, ...baseOptions, ...baseOptions],
    [baseOptions]
  )

  const selected = value ?? defaultValue

  const block = baseOptions.length
  const selectedIdx = baseOptions.indexOf(selected)
  const middleIdx = selectedIdx + block

  const itemRefs = useRef<HTMLButtonElement | null>(null)

  return (
    <div className="w-full">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" className="w-full text-left px-1 font-normal">
            {value ?? '—'}
          </Button>
        </PopoverTrigger>

        <PopoverContent
          className="w-24 p-0"
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            itemRefs.current?.scrollIntoView({ block: 'center' })
          }}
        >
          <ScrollArea className="h-64">
            <div className="flex flex-col">
              {options.map((time, i) => {
                const isMiddle = i === middleIdx
                const isActive = time === selected && isMiddle

                return (
                  <button
                    key={`${time}-${i}`}
                    ref={(el) => {
                      if (isMiddle) itemRefs.current = el
                    }}
                    className={cn(
                      'w-full px-3 py-2 text-sm text-left hover:bg-gray-100',
                      isActive && 'bg-gray-200'
                    )}
                    onClick={() => {
                      onChange(time)
                      setOpen(false)
                    }}
                  >
                    {time}
                  </button>
                )
              })}
            </div>
          </ScrollArea>
        </PopoverContent>
      </Popover>
    </div>
  )
}
