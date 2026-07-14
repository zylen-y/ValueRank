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
              <PolarGrid stroke="#262626" />
              <PolarAngleAxis dataKey="axis" tick={{ fill: '#a1a1a1', fontSize: 10 }} />
              <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
              <Radar name="goal u" dataKey="goal" stroke="#0070f3" fill="#0070f3" fillOpacity={0.08} strokeDasharray="4 3" />
              <Radar name="you" dataKey="you" stroke="#bf7af0" fill="#bf7af0" fillOpacity={0.25} isAnimationActive />
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
              <XAxis dataKey="step" tick={{ fill: '#a1a1a1', fontSize: 10 }} stroke="#262626" />
              <YAxis tick={{ fill: '#a1a1a1', fontSize: 10 }} stroke="#262626" />
              <Tooltip
                contentStyle={{ background: '#111111', border: '1px solid #262626', borderRadius: 8, fontSize: 11 }}
                labelStyle={{ color: '#a1a1a1' }}
              />
              <Line type="monotone" dataKey="valuerank" name="ValueRank" stroke="#bf7af0" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="engagement" name="Engagement feed" stroke="#ff6166" strokeWidth={2} dot={false} strokeDasharray="5 4" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}
