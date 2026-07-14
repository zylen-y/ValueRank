import type { ShiftAudit } from '../engine/types'

function Meter({ label, audit, color }: { label: string; audit: ShiftAudit; color: string }) {
  const total = audit.onGoal + audit.offGoal
  const pct = total === 0 ? 0 : (audit.onGoal / total) * 100
  const ratio = audit.offGoal === 0 ? '—' : (audit.onGoal / audit.offGoal).toFixed(2)
  return (
    <div className="rounded-lg border border-line bg-panel2 p-3">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-semibold" style={{ color }}>{label}</span>
        <span className="text-[10px] text-mute">
          ‖ΔP∥‖/‖ΔP⊥‖ = <span className="tabular-nums text-bright">{ratio}</span>
        </span>
      </div>
      <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-ink">
        <div className="flex h-full">
          <div className="h-full bg-accent transition-all duration-500" style={{ width: `${pct}%` }} />
          <div className="h-full bg-hot transition-all duration-500" style={{ width: `${total === 0 ? 0 : 100 - pct}%` }} />
        </div>
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] tabular-nums">
        <span className="text-accent">on-goal ΔP∥ {audit.onGoal.toFixed(3)}</span>
        <span className="text-hot">off-goal ΔP⊥ {audit.offGoal.toFixed(3)}</span>
      </div>
    </div>
  )
}

export function AuditPanel({ vr, eng }: { vr: ShiftAudit; eng: ShiftAudit }) {
  const flagged = eng.offGoal > 0 && eng.offGoal > eng.onGoal
  return (
    <div className="rounded-xl border border-line bg-panel p-3">
      <div className="px-1 text-sm font-semibold">Shift audit</div>
      <div className="px-1 text-[11px] text-mute">
        Every induced change in you decomposes into ΔP∥ (toward your declared goal) and ΔP⊥ (drift you never asked for).
      </div>
      <div className="mt-3 space-y-2">
        <Meter label="ValueRank policy" audit={vr} color="#bf7af0" />
        <Meter label="Engagement policy (counterfactual)" audit={eng} color="#ff6166" />
      </div>
      {flagged && (
        <div className="mt-2 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-[11px] text-warn">
          ⚠ Audit: engagement policy is shifting you more <em>off</em>-goal than toward your goal.
        </div>
      )}
      <div className="mt-2 px-1 text-[10px] leading-relaxed text-mute">
        This is the safety story: value = projection, so influence on the user is <em>measurable</em>, not assumed away.
      </div>
    </div>
  )
}
