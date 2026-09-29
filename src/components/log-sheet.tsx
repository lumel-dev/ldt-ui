import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ExternalLinkIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { ldt, type DevProc } from '@/lib/ldt'
import { cn } from '@/lib/utils'

// Los escapes ANSI son justo lo que se busca sacar.
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g
// Mismo criterio que `ldt dev logs --errors`.
const ERROR = /error|failed|exception|traceback|warn|econnrefused/i
const MAX_LINES = 4000

interface Props {
  title: string
  proc: DevProc | null
  onClose: () => void
}

export function LogSheet({ title, proc, onClose }: Props) {
  const [lines, setLines] = useState<string[]>([])
  const [onlyErrors, setOnlyErrors] = useState(false)
  const box = useRef<HTMLPreElement>(null)
  const stick = useRef(true)
  const path = proc?.log ?? null

  // Lectura incremental por offset en bytes: cada tick trae solo lo nuevo, y si el log se
  // trunco (un `dev start` nuevo lo vacia) `reset` avisa que hay que empezar de cero.
  useEffect(() => {
    if (!path) return
    let offset = -1
    let partial = ''
    let alive = true
    const tick = async () => {
      try {
        const chunk = await ldt.readLog(path, offset)
        if (!alive) return
        offset = chunk.offset
        const text = (chunk.reset ? '' : partial) + chunk.text.replace(ANSI, '')
        const parts = text.split(/\r?\n/)
        partial = parts.pop() ?? ''
        setLines((prev) => (chunk.reset ? parts : [...prev, ...parts]).slice(-MAX_LINES))
      } catch {
        // el log todavia no existe o se borro: se reintenta en el proximo tick
      }
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [path])

  const shown = useMemo(() => (onlyErrors ? lines.filter((l) => ERROR.test(l)) : lines), [lines, onlyErrors])

  useLayoutEffect(() => {
    const el = box.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [shown])

  return (
    <Sheet open={proc !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full gap-0 bg-card sm:max-w-3xl data-[side=right]:sm:max-w-3xl">
        <SheetHeader className="border-b pr-12">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription className="truncate font-mono text-xs">$ {proc?.cmd}</SheetDescription>
          <div className="mt-2 flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Switch checked={onlyErrors} onCheckedChange={setOnlyErrors} />
              Solo errores
            </label>
            {proc?.url && (
              <Button size="xs" variant="outline" onClick={() => ldt.open('url', proc.url!)}>
                <ExternalLinkIcon /> {proc.url}
              </Button>
            )}
          </div>
        </SheetHeader>
        <pre
          ref={box}
          onScroll={(e) => {
            const el = e.currentTarget
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
          }}
          className="min-h-0 flex-1 overflow-auto bg-background p-4 font-mono text-xs leading-relaxed"
        >
          {shown.length === 0 && (
            <span className="text-muted-foreground">{onlyErrors ? 'Sin errores.' : 'Esperando salida…'}</span>
          )}
          {shown.map((line, i) => (
            <div key={i} className={cn('whitespace-pre-wrap break-all', ERROR.test(line) && 'text-destructive')}>
              {line || ' '}
            </div>
          ))}
        </pre>
      </SheetContent>
    </Sheet>
  )
}
