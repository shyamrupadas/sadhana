import { useState, useMemo, useRef } from 'react'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'

type TimePickerProps = {
  value: string | null
  defaultValue: string
  onChange: (val: string) => void
}

export const TimePicker = ({ value, defaultValue, onChange }: TimePickerProps) => {
  const [open, setOpen] = useState(false)
  const options = useMemo(() => {
    const arr: string[] = []
    for (let h = 0; h < 24; h++) {
      for (let m = 0; m < 60; m += 15) {
        arr.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
      }
    }
    return arr
  }, [])

  // Взять либо текущее значение, либо дефолт
  const selected = value ?? defaultValue
  // Рефы на элементы списка
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  return (
    <div className="w-full max-w-xs">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="w-full text-left">
            {value ?? '—'}
          </Button>
        </PopoverTrigger>

        <PopoverContent
          className="w-[120px] p-0"
          //  ─── здесь и происходит прокрутка ───
          onOpenAutoFocus={() => {
            itemRefs.current[selected]?.scrollIntoView({
              block: 'center',
            })
          }}
        >
          <ScrollArea className="h-64">
            <div className="flex flex-col">
              {options.map((time) => (
                <button
                  key={time}
                  ref={(el) => {
                    // сохраняем ref для выбранного времени
                    if (time === selected) itemRefs.current[time] = el
                  }}
                  className={`w-full px-3 py-2 text-sm text-left hover:bg-gray-100 ${
                    time === selected ? 'bg-gray-200 font-semibold' : ''
                  }`}
                  onClick={() => {
                    onChange(time)
                    setOpen(false)
                  }}
                >
                  {time}
                </button>
              ))}
            </div>
          </ScrollArea>
        </PopoverContent>
      </Popover>
    </div>
  )
}
