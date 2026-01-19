import { useState, useMemo, useRef } from 'react'
import { Popover, PopoverTrigger, PopoverContent } from '@/shared/components/ui/popover'
import { ScrollArea } from '@/shared/components/ui/scroll-area'
import { cn } from '@/shared/lib/utils'
import { Button } from './ui/button'

type DurationPickerProps = {
  value: string | null
  defaultValue: string
  onChange: (val: string) => void
  maxHours?: number
  disabled?: boolean
}

const MAX_HOURS = 8

export const DurationPicker = ({
  value,
  defaultValue,
  onChange,
  disabled = false,
}: DurationPickerProps) => {
  const [open, setOpen] = useState(false)

  const options = useMemo(() => {
    const arr: string[] = []
    for (let h = 0; h <= MAX_HOURS; h++) {
      for (let m = 0; m < 60; m += 15) {
        if (h === MAX_HOURS && m > 0) break
        arr.push(`${h}:${String(m).padStart(2, '0')}`)
      }
    }
    return arr
  }, [])

  const selected = value ?? defaultValue

  const itemRef = useRef<HTMLButtonElement | null>(null)

  return (
    <div className="w-full">
      <Popover
        open={open}
        onOpenChange={(nextOpen) => {
          if (disabled) return
          setOpen(nextOpen)
        }}
      >
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            className="w-full text-left px-1 font-normal"
            disabled={disabled}
          >
            {value ?? '—'}
          </Button>
        </PopoverTrigger>

        <PopoverContent
          className="w-24 p-0"
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            itemRef.current?.scrollIntoView({ block: 'center' })
          }}
        >
          <ScrollArea className="h-48">
            <div className="flex flex-col">
              {options.map((dur, i) => {
                const isActive = dur === selected
                return (
                  <button
                    key={`${dur}-${i}`}
                    ref={(el) => {
                      if (isActive) itemRef.current = el
                    }}
                    className={cn(
                      'w-full px-3 py-2 text-sm text-left hover:bg-gray-100',
                      isActive && 'bg-gray-200'
                    )}
                    onClick={() => {
                      onChange(dur)
                      setOpen(false)
                    }}
                  >
                    {dur}
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
