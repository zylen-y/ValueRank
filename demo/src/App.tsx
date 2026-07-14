import { useMemo, useRef, useState } from 'react'
import { ARTICLES } from './data/articles'
import { GOALS } from './data/goals'
import type { Article, Goal, ShiftAudit, Vec8 } from './engine/types'
import {
  accumulateAudit,
  goalProgress,
  rankByEngagement,
  rankByLLM,
  rankByValue,
  sub,
  transition,
} from './engine/engine'
import { GoalBar } from './components/GoalBar'
import { FeedColumn } from './components/Feed'
import { StatePanel } from './components/StatePanel'
import { AuditPanel } from './components/AuditPanel'

const BASE_P: Vec8 = [0.12, 0.08, 0.05, 0.1, 0.15, 0.05, 0.08, 0.2]

interface Session {
  P: Vec8
  Peng: Vec8
  readIds: Set<string>
  engReadIds: Set<string>
  auditVr: ShiftAudit
  auditEng: ShiftAudit
  history: Array<{ step: number; valuerank: number; engagement: number }>
}

const freshSession = (u: Vec8): Session => {
  const p0 = +goalProgress(BASE_P, u).toFixed(3)
  return {
    P: BASE_P,
    Peng: BASE_P,
    readIds: new Set(),
    engReadIds: new Set(),
    auditVr: { onGoal: 0, offGoal: 0 },
    auditEng: { onGoal: 0, offGoal: 0 },
    history: [{ step: 0, valuerank: p0, engagement: p0 }],
  }
}

/** Pure session step — safe under StrictMode double-invocation. */
function stepSession(s: Session, u: Vec8, x?: Article): Session {
  const pick = x && !s.readIds.has(x.id)
    ? x
    : rankByValue(ARTICLES.filter((a) => !s.readIds.has(a.id)), s.P, u)[0]
  if (!pick) return s
  const nextP = transition(s.P, pick)

  const engPick = rankByEngagement(ARTICLES.filter((a) => !s.engReadIds.has(a.id)))[0]
  const nextE = engPick ? transition(s.Peng, engPick) : s.Peng

  return {
    P: nextP,
    Peng: nextE,
    readIds: new Set(s.readIds).add(pick.id),
    engReadIds: engPick ? new Set(s.engReadIds).add(engPick.id) : s.engReadIds,
    auditVr: accumulateAudit(s.auditVr, sub(nextP, s.P), u),
    auditEng: accumulateAudit(s.auditEng, sub(nextE, s.Peng), u),
    history: [
      ...s.history,
      {
        step: s.history.length,
        valuerank: +goalProgress(nextP, u).toFixed(3),
        engagement: +goalProgress(nextE, u).toFixed(3),
      },
    ],
  }
}

export default function App() {
  const [goal, setGoal] = useState<Goal>(GOALS[0])
  const [session, setSession] = useState<Session>(() => freshSession(GOALS[0].weights))
  const [autoRunning, setAutoRunning] = useState(false)
  const timer = useRef<number | null>(null)

  const u = goal.weights
  const { P, readIds, engReadIds, auditVr, auditEng, history } = session

  const byEngagement = useMemo(() => rankByEngagement(ARTICLES), [])
  const byLLM = useMemo(() => rankByLLM(ARTICLES, goal), [goal])
  const byValue = useMemo(
    () => rankByValue(ARTICLES.filter((a) => !readIds.has(a.id)), P, u),
    [P, u, readIds],
  )

  const step = (x?: Article) => setSession((s) => stepSession(s, u, x))

  const autoRun = () => {
    if (autoRunning) return
    setAutoRunning(true)
    let n = 0
    timer.current = window.setInterval(() => {
      step()
      if (++n >= 10) {
        window.clearInterval(timer.current!)
        setAutoRunning(false)
      }
    }, 400)
  }

  const reset = () => {
    if (timer.current) window.clearInterval(timer.current)
    setAutoRunning(false)
    setSession(freshSession(u))
  }

  const setWeight = (axis: number, v: number) => {
    setGoal((g) => ({ ...g, weights: g.weights.map((w, i) => (i === axis ? v : w)) }))
  }

  return (
    <div className="flex h-screen flex-col bg-ink text-bright">
      <GoalBar goal={goal} onGoal={setGoal} onWeight={setWeight} />
      <div className="grid min-h-0 flex-1 grid-cols-[320px_1fr_1fr_1fr_300px] gap-3 p-3">
        <StatePanel P={P} u={u} history={history} onAuto={autoRun} autoRunning={autoRunning} onReset={reset} />
        <FeedColumn
          title="Engagement feed"
          subtitle="ranked by predicted clicks — today's internet"
          color="#6e6c66"
          items={byEngagement}
          readIds={engReadIds}
        />
        <FeedColumn
          title="LLM re-ranker"
          subtitle="goal-conditioned relevance — blind to your state"
          color="#a8a59d"
          items={byLLM}
          readIds={new Set()}
        />
        <FeedColumn
          title="ValueRank"
          subtitle="V = ⟨f(P,x) − P, u⟩ — predicted change in you"
          color="#4d7cfe"
          items={byValue}
          readIds={readIds}
          P={P}
          u={u}
          onRead={step}
        />
        <AuditPanel vr={auditVr} eng={auditEng} />
      </div>
    </div>
  )
}
