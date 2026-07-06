'use client'

// Brain Ball — app shell: kid picker → home (skill menu) → game → summary,
// plus the reward shop and the grown-ups dashboard.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Lock } from 'lucide-react'
import { ageLabel, brainLevel } from '@/lib/game/adaptive'
import { ADULT_SKILL_NAMES, SKILLS } from '@/lib/game/questions'
import { speak } from '@/lib/game/speech'
import { BALL_SKINS, loadProfiles, saveProfiles } from '@/lib/game/storage'
import type { KidProfile, RoundResult, SkillId } from '@/lib/game/types'
import { AnswerDelta, BallGame } from './BallGame'
import { ParentDashboard } from './ParentDashboard'
import { PersonalityQuiz } from './PersonalityQuiz'
import { retakeDue, TEMPERAMENTS, type PersonalityResult } from '@/lib/game/personality'

type Screen = 'pick' | 'greatday' | 'home' | 'game' | 'summary' | 'shop' | 'parents' | 'whoami'

/** local calendar day as YYYY-MM-DD */
const localDay = (d = new Date()) => d.toLocaleDateString('en-CA')
const QUEST_ROUNDS = 3
const QUEST_BONUS = 15

export function PlayApp() {
  const [profiles, setProfiles] = useState<KidProfile[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [screen, setScreen] = useState<Screen>('pick')
  const [gameSkill, setGameSkill] = useState<SkillId | 'mix'>('mix')
  const [lastResult, setLastResult] = useState<RoundResult | null>(null)
  const [gameKey, setGameKey] = useState(0)

  useEffect(() => {
    setProfiles(loadProfiles())
  }, [])

  // debounce-push progress to the parent's cloud account (no-op when signed
  // out or in demo mode — sync.ts guards internally)
  useEffect(() => {
    if (profiles.length === 0) return
    const t = window.setTimeout(() => {
      import('@/lib/game/sync').then(({ cloudEnabled, pushCloudProfiles }) => {
        if (cloudEnabled) pushCloudProfiles(profiles).catch(() => {})
      })
    }, 2500)
    return () => window.clearTimeout(t)
  }, [profiles])

  const kid = useMemo(() => profiles.find((p) => p.id === activeId) ?? null, [profiles, activeId])

  const updateKid = useCallback((id: string, fn: (k: KidProfile) => KidProfile) => {
    setProfiles((prev) => {
      const next = prev.map((p) => (p.id === id ? fn(p) : p))
      saveProfiles(next)
      return next
    })
  }, [])

  // ---------------------------------------------------------- game callbacks
  const handleAnswer = useCallback(
    (delta: AnswerDelta) => {
      if (!activeId) return
      updateKid(activeId, (k) => ({
        ...k,
        coins: k.coins + delta.coins,
        xp: k.xp + delta.xp,
        history: [...k.history, { t: Date.now(), skill: delta.skill, difficulty: delta.difficulty, correct: delta.correct, ms: delta.ms }],
        skills: {
          ...k.skills,
          [delta.skill]: {
            ...k.skills[delta.skill],
            theta: delta.newTheta,
            attempts: k.skills[delta.skill].attempts + 1,
            correct: k.skills[delta.skill].correct + (delta.correct ? 1 : 0),
            bestStreak: k.skills[delta.skill].bestStreak, // streak merged on round end
          },
        },
      }))
    },
    [activeId, updateKid]
  )

  const handleComplete = useCallback(
    (result: RoundResult) => {
      if (!activeId) return
      const today = localDay()
      const yesterday = localDay(new Date(Date.now() - 86400000))
      let questBonus = 0
      updateKid(activeId, (k) => {
        const roundsToday = (k.lastPlayedDay === today ? k.roundsToday ?? 0 : 0) + 1
        const dayStreak = k.lastPlayedDay === today ? k.dayStreak ?? 1 : k.lastPlayedDay === yesterday ? (k.dayStreak ?? 0) + 1 : 1
        const questDone = roundsToday >= QUEST_ROUNDS && k.questClaimedDay !== today
        if (questDone) questBonus = QUEST_BONUS
        return {
          ...k,
          // round-end bonuses (per-answer coins already applied)
          coins: k.coins + result.stars * 5 + (result.chestBonus ?? 0) + questBonus,
          stars: k.stars + result.stars,
          roundsPlayed: k.roundsPlayed + 1,
          lastPlayedDay: today,
          roundsToday,
          dayStreak,
          questClaimedDay: questDone ? today : k.questClaimedDay,
          reviewQueue: result.reviewQueue ?? k.reviewQueue,
          skills:
            result.skill === 'mix'
              ? k.skills
              : {
                  ...k.skills,
                  [result.skill]: {
                    ...k.skills[result.skill],
                    bestStreak: Math.max(k.skills[result.skill].bestStreak, result.bestStreak),
                  },
                },
        }
      })
      setLastResult({ ...result, questBonus })
      setScreen('summary')
    },
    [activeId, updateKid]
  )

  const handlePersonality = useCallback(
    (r: PersonalityResult) => {
      if (!activeId) return
      updateKid(activeId, (k) => ({
        ...k,
        coins: k.coins + 10, // small thank-you for finishing the quiz
        personality: { current: r, history: [...(k.personality?.history ?? []), r].slice(-8) },
      }))
    },
    [activeId, updateKid]
  )

  const startGame = (skillChoice: SkillId | 'mix') => {
    setGameSkill(skillChoice)
    setGameKey((k) => k + 1)
    setScreen('game')
  }

  const buySkin = (skinId: string) => {
    if (!kid) return
    const skin = BALL_SKINS.find((s) => s.id === skinId)
    if (!skin) return
    if (kid.ownedSkins.includes(skinId)) {
      updateKid(kid.id, (k) => ({ ...k, activeSkin: skinId }))
      return
    }
    if (kid.coins < skin.cost) return
    updateKid(kid.id, (k) => ({
      ...k,
      coins: k.coins - skin.cost,
      ownedSkins: [...k.ownedSkins, skinId],
      activeSkin: skinId,
    }))
  }

  // ---------------------------------------------------------- screens
  if (screen === 'pick' || !kid) {
    return (
      <Shell>
        <div className="text-center pt-10 pb-6">
          <span className="inline-block text-xs font-extrabold uppercase tracking-widest bg-blue-600 text-white rounded-full px-3 py-1 mb-3">
            🐋🐗 A Whalehogs Game
          </span>
          <div className="text-6xl mb-2">🧠⚽</div>
          <h1 className="text-4xl font-black text-slate-800">Brain Ball</h1>
          <p className="text-slate-500 font-semibold mt-1">Roll. Answer. Grow your ball!</p>
        </div>
        <p className="text-center text-sm font-bold text-slate-400 uppercase tracking-wide mb-3">Which Whalehog is playing?</p>
        <div className="grid grid-cols-2 gap-4 px-6 max-w-md mx-auto">
          {profiles.map((p) => {
            const lvl = brainLevel(p)
            return (
              <button
                key={p.id}
                onClick={() => {
                  setActiveId(p.id)
                  setScreen('greatday')
                  // speak inside the tap gesture so mobile browsers allow it
                  speak("Dada says: Today's going to be a…", { rate: 0.95, pitch: 1.1 })
                }}
                className="rounded-3xl bg-white border-2 border-blue-200 shadow-lg p-5 flex flex-col items-center gap-1 active:scale-95 transition-transform"
              >
                <span className="text-5xl">{p.avatar}</span>
                <span className="text-xl font-extrabold text-slate-800">{p.name}</span>
                {p.isTester ? (
                  <span className="text-[10px] font-extrabold uppercase tracking-wide bg-slate-200 text-slate-500 rounded-full px-2 py-0.5">
                    Grown-up tester
                  </span>
                ) : (
                  <span className="text-xs font-bold text-blue-500">Brain Level {lvl.level}</span>
                )}
                <span className="text-xs font-semibold text-yellow-600">🪙 {p.coins} · ⭐ {p.stars}</span>
              </button>
            )
          })}
        </div>
      </Shell>
    )
  }

  if (screen === 'greatday') {
    return (
      <Shell>
        <GreatDay onDone={() => setScreen('home')} />
      </Shell>
    )
  }

  if (screen === 'game') {
    const isDailyDouble = kid.lastPlayedDay !== localDay()
    return (
      <Shell noPad>
        <BallGame
          key={gameKey}
          profile={kid}
          skill={gameSkill}
          dailyDouble={isDailyDouble}
          onAnswer={handleAnswer}
          onComplete={handleComplete}
          onQuit={() => setScreen('home')}
        />
      </Shell>
    )
  }

  if (screen === 'whoami') {
    return (
      <Shell>
        <PersonalityQuiz kid={kid} onResult={handlePersonality} onExit={() => setScreen('home')} />
      </Shell>
    )
  }

  if (screen === 'summary' && lastResult) {
    const r = lastResult
    return (
      <Shell>
        <div className="max-w-md mx-auto px-6 pt-12 text-center">
          <div className="text-6xl mb-3">{r.stars === 3 ? '🏆' : r.stars === 2 ? '🎉' : '💪'}</div>
          <h2 className="text-3xl font-black text-slate-800 mb-1">
            {r.correct} out of {r.total}!
          </h2>
          <div className="text-4xl my-3" aria-label={`${r.stars} stars`}>
            {'⭐'.repeat(r.stars)}
            <span className="opacity-20">{'⭐'.repeat(3 - r.stars)}</span>
          </div>
          <div className="rounded-2xl bg-white border-2 border-yellow-200 shadow p-4 mb-2">
            <p className="text-lg font-extrabold text-yellow-600">+{r.coinsEarned + (r.questBonus ?? 0)} 🪙 coins earned</p>
            {r.dailyDouble && <p className="text-sm font-bold text-orange-500 mt-1">🌅 Daily Double — first round today paid 2×!</p>}
            {(r.chestBonus ?? 0) > 0 && <p className="text-sm font-bold text-purple-600 mt-1">🎁 Mystery chest: +{r.chestBonus} bonus coins!</p>}
            {(r.questBonus ?? 0) > 0 && <p className="text-sm font-bold text-blue-600 mt-1">🎯 Daily quest complete: +{r.questBonus} coins!</p>}
            {(r.speedBonuses ?? 0) > 0 && <p className="text-sm font-bold text-amber-600 mt-1">⚡ Lightning answers: {r.speedBonuses}</p>}
            {(r.readBonuses ?? 0) > 0 && <p className="text-sm font-bold text-blue-500 mt-1">📖 Read it yourself: {r.readBonuses} — that&apos;s reading!</p>}
            {r.bestStreak >= 3 && <p className="text-sm font-bold text-orange-500 mt-1">🔥 Best streak: {r.bestStreak} in a row!</p>}
          </div>
          {r.misses && r.misses.length > 0 && (
            <div className="rounded-2xl bg-white border-2 border-orange-200 shadow p-4 mb-2 text-left">
              <p className="text-xs font-extrabold text-slate-400 uppercase tracking-wide mb-2 text-center">
                Let&apos;s learn from the tricky ones
              </p>
              {r.misses.map((m, i) => {
                const meta = SKILLS.find((s) => s.id === m.skill)!
                const line = `${m.prompt} The answer was ${m.answer}. ${m.explain ?? ''}`
                return (
                  <div key={i} className={`py-2 ${i > 0 ? 'border-t border-slate-100' : ''}`}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-extrabold text-slate-700">
                        {meta.emoji} {m.prompt}
                        {m.visual ? <span className="block text-xl leading-snug whitespace-pre-wrap">{m.visual}</span> : null}
                      </p>
                      <button
                        onClick={() => speak(line, { rate: 0.92, pitch: 1.1 })}
                        aria-label="Read this explanation aloud"
                        className="shrink-0 w-8 h-8 rounded-full bg-blue-500 text-white text-sm flex items-center justify-center active:scale-90"
                      >
                        🔊
                      </button>
                    </div>
                    <p className="text-xs font-bold mt-1">
                      <span className="text-orange-500">You picked {m.picked}</span>
                      <span className="text-slate-400"> · </span>
                      <span className="text-green-600">it was {m.answer}</span>
                    </p>
                    {m.explain && <p className="text-xs text-slate-500 font-semibold mt-0.5">{m.explain}</p>}
                  </div>
                )
              })}
            </div>
          )}
          {r.deltas && r.deltas.length > 0 && (
            <div className="rounded-2xl bg-white border-2 border-blue-200 shadow p-4 mb-2 text-left">
              <p className="text-xs font-extrabold text-slate-400 uppercase tracking-wide mb-2 text-center">Skill levels this round</p>
              {r.deltas.map((d) => {
                const meta = SKILLS.find((s) => s.id === d.skill)!
                const up = d.to > d.from
                return (
                  <div key={d.skill} className="flex items-center justify-between py-0.5">
                    <span className="text-sm font-bold text-slate-600">
                      {meta.emoji} {meta.name}
                    </span>
                    <span className={`text-sm font-extrabold ${up ? 'text-green-600' : 'text-orange-500'}`}>
                      {d.from} → {d.to} {up ? '📈' : '📉'}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
          <p className="text-sm text-slate-500 font-semibold mb-6">
            {r.correct === r.total
              ? 'PERFECT round — Whalehogs are on FIRE! It gets trickier now!'
              : r.stars >= 2
              ? 'Awesome work, keep rolling!'
              : "We don't say can't — every roll makes a Whalehog smarter!"}
          </p>
          <div className="grid gap-3">
            <BigButton color="green" onClick={() => startGame(gameSkill)}>
              ▶️ Play again
            </BigButton>
            <BigButton color="blue" onClick={() => setScreen('shop')}>
              🛍️ Spend coins
            </BigButton>
            <BigButton color="slate" onClick={() => setScreen('parents')}>
              📊 Full report (grown-ups)
            </BigButton>
            <BigButton color="slate" onClick={() => setScreen('home')}>
              🏠 Home
            </BigButton>
          </div>
        </div>
      </Shell>
    )
  }

  if (screen === 'shop') {
    return (
      <Shell>
        <Header title="Ball Shop" coins={kid.coins} onBack={() => setScreen('home')} />
        <div className="max-w-md mx-auto px-4 grid grid-cols-2 gap-3 pb-8">
          {BALL_SKINS.map((s) => {
            const owned = kid.ownedSkins.includes(s.id)
            const active = kid.activeSkin === s.id
            const affordable = kid.coins >= s.cost
            return (
              <button
                key={s.id}
                onClick={() => buySkin(s.id)}
                disabled={!owned && !affordable}
                className={`rounded-2xl border-2 p-4 flex flex-col items-center gap-1 bg-white shadow active:scale-95 transition-transform ${
                  active ? 'border-green-500 ring-2 ring-green-200' : owned ? 'border-blue-200' : affordable ? 'border-yellow-300' : 'border-slate-200 opacity-60'
                }`}
              >
                <span
                  className="w-14 h-14 rounded-full flex items-center justify-center text-2xl shadow-inner"
                  style={{ background: `radial-gradient(circle at 30% 30%, ${s.colors[0]}, ${s.colors[1]})` }}
                >
                  {s.emoji ?? ''}
                </span>
                <span className="font-extrabold text-slate-700 text-sm">{s.name}</span>
                {active ? (
                  <span className="text-xs font-bold text-green-600">✓ Rolling with it!</span>
                ) : owned ? (
                  <span className="text-xs font-bold text-blue-500">Tap to use</span>
                ) : (
                  <span className={`text-xs font-bold ${affordable ? 'text-yellow-600' : 'text-slate-400'}`}>🪙 {s.cost}</span>
                )}
              </button>
            )
          })}
        </div>
        <p className="text-center text-xs text-slate-400 pb-6">Earn coins by answering questions — streaks earn bonus coins!</p>
      </Shell>
    )
  }

  if (screen === 'parents') {
    return (
      <Shell>
        <ParentDashboard
          profiles={profiles}
          onBack={() => setScreen('home')}
          onRestore={(merged) => {
            setProfiles(merged)
            saveProfiles(merged)
          }}
        />
      </Shell>
    )
  }

  // ---------------------------------------------------------- home
  const lvl = brainLevel(kid)
  const today = localDay()
  const roundsToday = kid.lastPlayedDay === today ? kid.roundsToday ?? 0 : 0
  const dayStreak = kid.lastPlayedDay === today || kid.lastPlayedDay === localDay(new Date(Date.now() - 86400000)) ? kid.dayStreak ?? 0 : 0
  const questClaimed = kid.questClaimedDay === today
  const quizDue = retakeDue(kid.personality)
  const temperament = kid.personality ? TEMPERAMENTS[kid.personality.current.primary] : null
  return (
    <Shell>
      <div className="max-w-md mx-auto px-4 pb-10">
        <div className="flex items-center justify-between pt-4 pb-2">
          <button
            onClick={() => setScreen('pick')}
            className="flex items-center gap-2 rounded-full bg-white border-2 border-blue-200 pl-2 pr-4 py-1.5 shadow active:scale-95"
          >
            <span className="text-2xl">{kid.avatar}</span>
            <span className="font-extrabold text-slate-700">{kid.name}</span>
          </button>
          <div className="flex items-center gap-2">
            <span className="text-sm font-extrabold text-yellow-600 bg-yellow-100 border border-yellow-300 rounded-full px-3 py-1">🪙 {kid.coins}</span>
            <span className="text-sm font-extrabold text-purple-600 bg-purple-100 border border-purple-300 rounded-full px-3 py-1">⭐ {kid.stars}</span>
          </div>
        </div>

        {/* level bar */}
        <div className="rounded-2xl bg-white border-2 border-blue-100 shadow p-3 mb-3">
          <div className="flex justify-between text-xs font-extrabold text-slate-500 mb-1">
            <span>🧠 Brain Level {lvl.level}</span>
            <span>{Math.round(lvl.progress * 25)}/25 to level {lvl.level + 1}</span>
          </div>
          <div className="h-3 rounded-full bg-slate-100 overflow-hidden">
            <div className="h-full rounded-full bg-gradient-to-r from-blue-400 to-purple-500 transition-all" style={{ width: `${Math.max(4, lvl.progress * 100)}%` }} />
          </div>
        </div>

        {/* daily quest + day streak */}
        <div className="rounded-2xl bg-white border-2 border-orange-200 shadow p-3 mb-4 flex items-center gap-3">
          <span className="text-2xl">{questClaimed ? '✅' : '🎯'}</span>
          <div className="flex-1">
            <div className="flex justify-between text-xs font-extrabold text-slate-600">
              <span>{questClaimed ? `Quest done! +${QUEST_BONUS} 🪙` : `Today's quest: play ${QUEST_ROUNDS} rounds (+${QUEST_BONUS} 🪙)`}</span>
              <span>{Math.min(roundsToday, QUEST_ROUNDS)}/{QUEST_ROUNDS}</span>
            </div>
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden mt-1">
              <div className="h-full rounded-full bg-orange-400 transition-all" style={{ width: `${Math.min(100, (roundsToday / QUEST_ROUNDS) * 100)}%` }} />
            </div>
          </div>
          {dayStreak >= 1 && (
            <span className="text-xs font-extrabold text-orange-600 bg-orange-100 border border-orange-300 rounded-full px-2 py-1 whitespace-nowrap">
              🔥 {dayStreak}-day
            </span>
          )}
        </div>

        <BigButton color="green" onClick={() => startGame('mix')}>
          🎲 Mix it up! <span className="block text-xs font-semibold opacity-80">A little of everything{roundsToday === 0 ? ' · 🌅 2× coins!' : ''}</span>
        </BigButton>

        <p className="text-xs font-extrabold text-slate-400 uppercase tracking-wide mt-5 mb-2">Or pick a challenge</p>
        <div className="grid grid-cols-2 gap-3">
          {SKILLS.map((s) => {
            const st = kid.skills[s.id]
            return (
              <button
                key={s.id}
                onClick={() => startGame(s.id)}
                className="rounded-2xl bg-white border-2 border-slate-200 shadow p-3 text-left active:scale-95 transition-transform"
              >
                <div className="text-2xl">{s.emoji}</div>
                <div className="font-extrabold text-slate-700">{kid.isTester ? ADULT_SKILL_NAMES[s.id] : s.name}</div>
                <div className="text-[11px] text-slate-400 font-semibold leading-tight">{kid.isTester ? 'Adult challenge' : s.blurb}</div>
                <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full rounded-full bg-green-400" style={{ width: `${st.theta}%` }} />
                </div>
              </button>
            )
          })}
        </div>

        {/* Who Am I? quiz */}
        <button
          onClick={() => setScreen('whoami')}
          className="w-full mt-4 rounded-2xl bg-white border-2 border-purple-200 shadow p-3 flex items-center gap-3 text-left active:scale-95 transition-transform"
        >
          <span className="text-3xl">{temperament ? temperament.animal : '🦁🦜🦉🐢'}</span>
          <span className="flex-1">
            <span className="block font-extrabold text-slate-700">
              {temperament ? `${kid.name} the ${temperament.title}` : 'Who Am I? quiz'}
            </span>
            <span className="block text-[11px] text-slate-400 font-semibold">
              {temperament ? (quizDue ? "You've grown — take it again!" : 'Tap to take it again') : 'Find your animal! +10 🪙'}
            </span>
          </span>
          {quizDue && <span className="text-[10px] font-extrabold bg-purple-500 text-white rounded-full px-2 py-0.5 animate-pulse">{temperament ? 'UPDATE' : 'NEW'}</span>}
        </button>

        <div className="grid grid-cols-2 gap-3 mt-3">
          <BigButton color="blue" onClick={() => setScreen('shop')}>
            🛍️ Ball Shop
          </BigButton>
          <button
            onClick={() => setScreen('parents')}
            className="rounded-2xl bg-white border-2 border-slate-200 shadow p-3 font-extrabold text-slate-500 flex items-center justify-center gap-2 active:scale-95"
          >
            <Lock className="w-4 h-4" /> Grown-ups
          </button>
        </div>
        <p className="text-center text-[11px] text-slate-400 mt-4">
          {kid.isTester
            ? `${kid.name} · grown-up tester — scores kept separate from the kids`
            : `${kid.name} · ${ageLabel(kid.birthdate)} · questions adapt to how ${kid.name} plays`}
        </p>
      </div>
    </Shell>
  )
}

// ---------------------------------------------------------------- great day ritual

const BURST = ['🎉', '⭐', '🐋', '🐗', '💥', '🌟', '🎊']

function GreatDay({ onDone }: { onDone: () => void }) {
  const [yelled, setYelled] = useState(false)
  const burst = useMemo(
    () =>
      Array.from({ length: 26 }, (_, i) => ({
        emoji: BURST[i % BURST.length],
        left: Math.random() * 90 + 2,
        top: Math.random() * 80 + 5,
        delay: Math.random() * 0.4,
        size: 22 + Math.random() * 26,
      })),
    []
  )

  const yell = () => {
    if (yelled) return
    setYelled(true)
    speak('A GREAT DAY!!', { rate: 1, pitch: 1.35 })
    window.setTimeout(onDone, 1800)
  }

  return (
    <div className="relative max-w-md mx-auto px-6 pt-20 text-center min-h-[80dvh] overflow-hidden">
      {yelled &&
        burst.map((b, i) => (
          <span
            key={i}
            className="absolute animate-ping pointer-events-none"
            style={{ left: `${b.left}%`, top: `${b.top}%`, fontSize: b.size, animationDelay: `${b.delay}s`, animationDuration: '1.1s' }}
          >
            {b.emoji}
          </span>
        ))}
      <div className="text-5xl mb-6">🐋🐗</div>
      <p className="text-sm font-extrabold uppercase tracking-widest text-slate-400 mb-2">Dada says…</p>
      <h2 className="text-3xl font-black text-slate-800 mb-2 leading-snug">
        &ldquo;Today&apos;s going to be a…&rdquo;
      </h2>
      <button
        onClick={() => speak("Dada says: Today's going to be a…", { rate: 0.95, pitch: 1.1 })}
        aria-label="Hear it again"
        className="mb-8 text-2xl active:scale-90 transition-transform"
      >
        🔊
      </button>
      {yelled ? (
        <div className="text-5xl font-black text-green-600 animate-bounce">GREAT DAY!!!</div>
      ) : (
        <button
          onClick={yell}
          className="rounded-3xl bg-gradient-to-b from-yellow-400 to-orange-500 border-b-8 border-orange-700 text-white text-4xl font-black px-10 py-6 shadow-2xl active:scale-95 active:border-b-2 transition-all animate-pulse"
        >
          GREAT DAY!!!
        </button>
      )}
      <p className="mt-14 text-[11px] text-slate-400 italic">
        &ldquo;He got a whalehog… wild heart&rdquo; — Marshall, singing Avicii
      </p>
    </div>
  )
}

// ---------------------------------------------------------------- bits

function Shell({ children, noPad }: { children: React.ReactNode; noPad?: boolean }) {
  // Game screen pins to the viewport (fixed inset-0) so the canvas always
  // fills the phone screen — percentage-height chains through flex are
  // unreliable here, and this also behaves correctly with mobile URL bars.
  const safeArea = {
    paddingTop: 'env(safe-area-inset-top)',
    paddingBottom: 'env(safe-area-inset-bottom)',
    paddingLeft: 'env(safe-area-inset-left)',
    paddingRight: 'env(safe-area-inset-right)',
  }
  if (noPad) {
    return (
      <div className="fixed inset-0 bg-gradient-to-b from-sky-100 via-blue-50 to-green-100 text-slate-800 flex flex-col" style={safeArea}>
        {children}
      </div>
    )
  }
  return (
    <div className="min-h-[100dvh] bg-gradient-to-b from-sky-100 via-blue-50 to-green-100 text-slate-800" style={safeArea}>
      <div className="pb-6">{children}</div>
    </div>
  )
}

function Header({ title, coins, onBack }: { title: string; coins?: number; onBack: () => void }) {
  return (
    <div className="max-w-md mx-auto flex items-center justify-between px-4 py-4">
      <button onClick={onBack} aria-label="Back" className="w-10 h-10 rounded-full bg-white border-2 border-slate-200 shadow flex items-center justify-center active:scale-95">
        <ArrowLeft className="w-5 h-5 text-slate-500" />
      </button>
      <h2 className="text-2xl font-black text-slate-800">{title}</h2>
      {coins !== undefined ? (
        <span className="text-sm font-extrabold text-yellow-600 bg-yellow-100 border border-yellow-300 rounded-full px-3 py-1">🪙 {coins}</span>
      ) : (
        <span className="w-10" />
      )}
    </div>
  )
}

function BigButton({ children, onClick, color }: { children: React.ReactNode; onClick: () => void; color: 'green' | 'blue' | 'slate' }) {
  const styles = {
    green: 'bg-gradient-to-b from-green-400 to-green-600 text-white border-green-700',
    blue: 'bg-gradient-to-b from-blue-400 to-blue-600 text-white border-blue-700',
    slate: 'bg-white text-slate-600 border-slate-200',
  }[color]
  return (
    <button onClick={onClick} className={`w-full rounded-2xl border-b-4 shadow-lg px-4 py-3.5 text-lg font-extrabold active:scale-95 active:border-b-2 transition-all ${styles}`}>
      {children}
    </button>
  )
}
