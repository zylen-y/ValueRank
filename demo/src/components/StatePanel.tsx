import {
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { Vec8 } from '../engine/types'
import { AXES } from '../engine/types'
import { unit } from '../engine/engine'

interface Props {
  P: Vec8
  u: Vec8
  history: Array<{ step: number; valuerank: number; engagement: number }>
  onAuto: () => void
  autoRunning: boolean
  onReset: () => void
}

export function StatePanel({ P, u, history, onAuto, autoRunning, onReset }: Props) {
  const uh = unit(u)
  const uMax = Math.max(...uh, 0.001)
  const radar = AXES.map((ax, i) => ({
    axis: ax.split(' ')[0],
    you: +(P[i] * 100).toFixed(1),
    goal: +((uh[i] / uMax) * 100).toFixed(1),
  }))

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="rounded-xl border border-line bg-panel p-3">
        <div className="flex items-center justify-between px-1">
          <div>
            <div className="text-sm font-semibold">Your state P<sub>t</sub></div>
            <div className="text-[11px] text-mute">vs. declared goal direction u</div>
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={onAuto}
              disabled={autoRunning}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-ink hover:opacity-90 disabled:opacity-40"
            >
              {autoRunning ? 'Running…' : 'Auto-run ×10'}
            </button>
            <button onClick={onReset} className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-mute hover:text-bright">
              Reset
            </button>
          </div>
        </div>
        <div className="h-56">
          <ResponsiveContainer>
            <RadarChart data={radar} outerRadius="72%">
              <PolarGrid stroke="#2a2a27" />
              <PolarAngleAxis dataKey="axis" tick={{ fill: '#8f8d86', fontSize: 10 }} />
              <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
              <Radar name="goal u" dataKey="goal" stroke="#8fa8e8" fill="#8fa8e8" fillOpacity={0.08} strokeDasharray="4 3" />
              <Radar name="you" dataKey="you" stroke="#4d7cfe" fill="#4d7cfe" fillOpacity={0.25} isAnimationActive />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-xl border border-line bg-panel p-3">
        <div className="px-1 text-sm font-semibold">Cumulative goal progress ⟨P<sub>t</sub>, û⟩</div>
        <div className="px-1 text-[11px] text-mute">ValueRank session vs. engagement-feed counterfactual</div>
        <div className="mt-1 h-40">
          <ResponsiveContainer>
            <LineChart data={history} margin={{ top: 8, right: 8, bottom: 0, left: -26 }}>
              <XAxis dataKey="step" tick={{ fill: '#8f8d86', fontSize: 10 }} stroke="#2a2a27" />
              <YAxis tick={{ fill: '#8f8d86', fontSize: 10 }} stroke="#2a2a27" />
              <Tooltip
                contentStyle={{ background: '#1c1c1a', border: '1px solid #2a2a27', borderRadius: 8, fontSize: 11 }}
                labelStyle={{ color: '#8f8d86' }}
              />
              <Line type="monotone" dataKey="valuerank" name="ValueRank" stroke="#4d7cfe" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="engagement" name="Engagement feed" stroke="#6e6c66" strokeWidth={2} dot={false} strokeDasharray="5 4" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}
