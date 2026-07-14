import { motion, AnimatePresence } from 'framer-motion'
import type { Article, Vec8 } from '../engine/types'
import { sub, transition, value } from '../engine/engine'

interface ColProps {
  title: string
  subtitle: string
  color: string
  items: Article[]
  readIds: Set<string>
  P?: Vec8
  u?: Vec8
  onRead?: (a: Article) => void
}

function Spark({ dP }: { dP: number[] }) {
  const max = Math.max(0.3, ...dP)
  return (
    <div className="flex h-4 items-end gap-[2px]">
      {dP.map((v, i) => (
        <div
          key={i}
          className="w-[5px] rounded-[1px] bg-accent"
          style={{ height: `${Math.max(6, (v / max) * 100)}%`, opacity: v > 0.005 ? 1 : 0.15 }}
        />
      ))}
    </div>
  )
}

export function FeedColumn({ title, subtitle, color, items, readIds, P, u, onRead }: ColProps) {
  const isVR = !!P && !!u
  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-line bg-panel">
      <div className="border-b border-line px-4 py-3">
        <div className="text-sm font-semibold" style={{ color }}>
          {title}
        </div>
        <div className="text-[11px] text-mute">{subtitle}</div>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        <AnimatePresence initial={false}>
          {items.slice(0, 12).map((a, rank) => {
            const read = readIds.has(a.id)
            const v = isVR ? value(P!, a, u!) : 0
            const dP = isVR ? sub(transition(P!, a), P!) : []
            return (
              <motion.div
                key={a.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: read ? 0.4 : 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                className={`rounded-lg border p-3 ${
                  a.clickbait && !isVR ? 'border-hot/30 bg-hot/5' : 'border-line bg-panel2'
                }`}
              >
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 w-4 shrink-0 text-right text-[11px] tabular-nums text-mute">{rank + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] leading-snug">{a.title}</div>
                    <div className="mt-1 flex items-center gap-2 text-[10px] text-mute">
                      <span>{a.source}</span>
                      <span>·</span>
                      <span>{a.minutes} min</span>
                      {!isVR && (
                        <span className={a.engagement > 0.8 ? 'text-hot' : ''}>
                          🔥 {(a.engagement * 100).toFixed(0)}
                        </span>
                      )}
                    </div>
                  </div>
                  {isVR && (
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="text-[11px] font-semibold tabular-nums text-accent">
                        V {v.toFixed(3)}
                      </span>
                      <Spark dP={dP} />
                      {onRead && !read && (
                        <button
                          onClick={() => onRead(a)}
                          className="rounded bg-accent/15 px-2 py-0.5 text-[10px] font-medium text-accent hover:bg-accent/25"
                        >
                          Read
                        </button>
                      )}
                      {read && <span className="text-[10px] text-mute">read ✓</span>}
                    </div>
                  )}
                </div>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </div>
  )
}
