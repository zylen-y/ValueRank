import { useState } from 'react'
import type { Goal } from '../engine/types'
import { AXES } from '../engine/types'
import { GOALS, encodeGoal } from '../data/goals'

interface Props {
  goal: Goal
  onGoal: (g: Goal) => void
  onWeight: (axis: number, v: number) => void
}

export function GoalBar({ goal, onGoal, onWeight }: Props) {
  const [text, setText] = useState(goal.text)
  const [encoding, setEncoding] = useState(false)

  const submit = (g?: Goal) => {
    const next = g ?? encodeGoal(text)
    if (g) setText(g.text)
    setEncoding(true)
    setTimeout(() => {
      onGoal(next)
      setEncoding(false)
    }, 450)
  }

  return (
    <div className="border-b border-line bg-panel px-6 py-4">
      <div className="flex items-center gap-3">
        <div className="shrink-0">
          <div className="text-lg font-semibold tracking-tight">
            Value<span className="text-accent">Rank</span>
          </div>
          <div className="text-[10px] text-mute -mt-0.5">rank by what it does to you</div>
        </div>
        <div className="relative flex-1">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="Declare your goal in natural language…"
            className="w-full rounded-lg border border-line bg-ink px-4 py-2.5 text-sm outline-none placeholder:text-mute focus:border-accent2"
          />
          {encoding && (
            <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-ink/70 text-xs text-accent2 backdrop-blur-[1px]">
              encoding goal → declared basis u …
            </div>
          )}
        </div>
        <button
          onClick={() => submit()}
          className="rounded-lg bg-accent2 px-4 py-2.5 text-sm font-medium text-ink hover:opacity-90"
        >
          Set goal
        </button>
        <div className="flex gap-1.5">
          {GOALS.map((g) => (
            <button
              key={g.id}
              onClick={() => submit(g)}
              className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                goal.id === g.id
                  ? 'border-accent2 bg-accent2/15 text-accent2'
                  : 'border-line text-mute hover:border-accent2/50 hover:text-bright'
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>

      {/* declared, human-auditable basis weights — editable */}
      <div className="mt-3 grid grid-cols-8 gap-3">
        {AXES.map((ax, i) => (
          <div key={ax} className="min-w-0">
            <div className="flex items-baseline justify-between">
              <span className="truncate text-[10px] text-mute">{ax}</span>
              <span className="ml-1 text-[10px] tabular-nums text-accent2">{goal.weights[i].toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={goal.weights[i]}
              onChange={(e) => onWeight(i, Number(e.target.value))}
              className="w-full"
            />
          </div>
        ))}
      </div>
    </div>
  )
}
