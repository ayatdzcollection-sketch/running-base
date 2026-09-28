// Injury check: a short, rule-based triage for common running injuries.
// It screens and routes; it does not diagnose. Anything that could be a
// bone stress injury, a tear, or a nerve problem goes to a clinician.
//
// Sources for the rules (plain summary):
//  • Bone stress injuries: pain in one spot on the bone, pain when hopping,
//    and pain at night/rest are the classic warning signs → see a doctor.
//  • Pain-monitoring model (Silbernagel et al.): running is acceptable if
//    pain stays low during the run, settles by the next morning, and isn't
//    getting worse week to week. We use a conservative 3/10 limit for teens.
//  • Ottawa ankle rules: can't take 4 steps → needs an exam.
import { addDays } from './dates.ts';
import { RULES } from './rules.ts';
import type { CheckIn, ISODate, Injury, InjuryArea, Outcome } from './types.ts';

export type Answer = boolean | number | string;
export interface Question {
  id: string;
  text: string;
  help?: string;
  type: 'yesno' | 'scale' | 'choice';
  choices?: { value: string; label: string }[];
  /** Answering yes (or picking a listed value) means: stop, see someone. */
  redFlag?: boolean | string[];
}

const PAIN: Question = { id: 'pain', type: 'scale', text: 'How much does it hurt while you run? (0–10)', help: '0 is nothing, 10 is the worst pain you can imagine.' };
const WARM: Question = {
  id: 'warm', type: 'choice', text: 'As you warm up, does it…',
  choices: [{ value: 'better', label: 'Get better' }, { value: 'same', label: 'Stay the same' }, { value: 'worse', label: 'Get worse' }],
};
const MORNING: Question = { id: 'morning', type: 'yesno', text: 'Is it worse the next morning?' };
const HOP: Question = { id: 'hop', type: 'yesno', text: 'Hop 10 times on that leg. Does it hurt?', help: 'Skip this if it hurts too much to try. That counts as yes.', redFlag: true };
const NIGHT: Question = { id: 'night', type: 'yesno', text: 'Does it hurt at night or when you are resting?', redFlag: true };
const LIMP: Question = { id: 'limp', type: 'yesno', text: 'Are you limping when you walk?', redFlag: true };
const spot = (where: string): Question => ({
  id: 'spot', type: 'yesno', redFlag: true,
  text: `Press along ${where}. Does one spot really hurt?`,
  help: 'Use two fingers. Soreness spread over a few inches is different from one sharp spot.',
});

export const QUESTIONS: Record<InjuryArea, Question[]> = {
  shin: [PAIN, spot('your shin bone'), HOP, WARM, MORNING],
  foot: [
    PAIN,
    spot('the bones on top of your foot and your heel bone'),
    HOP,
    { id: 'firststeps', type: 'yesno', text: 'Is heel or arch pain worst on your first steps in the morning?' },
    NIGHT,
  ],
  ankle: [
    PAIN,
    { id: 'walk4', type: 'yesno', text: 'Can you walk 4 steps without limping?', redFlag: false },
    { id: 'pop', type: 'yesno', text: 'Did you feel a pop, or like someone kicked the back of your ankle?', redFlag: true },
    { id: 'rolled', type: 'yesno', text: 'Did you roll your ankle?' },
    { id: 'stiffam', type: 'yesno', text: 'Is the back of the ankle stiff and sore in the morning?' },
  ],
  knee: [
    PAIN,
    {
      id: 'where', type: 'choice', text: 'Where on the knee?',
      choices: [{ value: 'front', label: 'Front or around the kneecap' }, { value: 'outside', label: 'Outside' }, { value: 'inside', label: 'Inside' }, { value: 'behind', label: 'Behind' }],
    },
    { id: 'swelling', type: 'yesno', text: 'Is it swollen, or does the knee lock or give way?', redFlag: true },
    { id: 'stairs', type: 'yesno', text: 'Does it hurt on stairs or after sitting a long time?' },
    WARM,
  ],
  thigh: [
    PAIN,
    { id: 'sudden', type: 'yesno', text: 'Did it start suddenly with a sharp pull or a pop?' },
    { id: 'bruise', type: 'yesno', text: 'Is there bruising, or can you not walk normally?', redFlag: true },
    HOP,
    WARM,
  ],
  hip: [
    PAIN,
    { id: 'groin', type: 'yesno', text: 'Is the pain deep in the groin or the front of the hip?' },
    HOP,
    { id: 'side', type: 'yesno', text: 'Is it on the outside of the hip, and sore to lie on?' },
    NIGHT,
  ],
  back: [
    PAIN,
    { id: 'nerve', type: 'yesno', text: 'Does pain go down your leg, or is there numbness or tingling?', redFlag: true },
    { id: 'fall', type: 'yesno', text: 'Did it start after a fall or a hit?', redFlag: true },
    WARM,
    NIGHT,
  ],
  other: [PAIN, LIMP, NIGHT, WARM, MORNING],
};

export const AREA_LABEL: Record<InjuryArea, string> = {
  foot: 'Foot or heel', ankle: 'Ankle or Achilles', shin: 'Shin', knee: 'Knee',
  thigh: 'Thigh', hip: 'Hip or groin', back: 'Lower back', other: 'Somewhere else',
};

export interface TriageResult {
  outcome: Outcome;
  likely: string | null;
  redFlags: string[];
  reasons: string[];
  today: string;
  seeSomeoneIf: string[];
}

const yes = (a: Record<string, Answer>, k: string) => a[k] === true || a[k] === 'yes';

function likelyFor(area: InjuryArea, a: Record<string, Answer>): string | null {
  switch (area) {
    case 'shin': return yes(a, 'spot') || yes(a, 'hop') ? 'Possible shin stress fracture' : 'Shin splints';
    case 'foot':
      if (yes(a, 'spot') || yes(a, 'hop')) return 'Possible foot stress fracture';
      return yes(a, 'firststeps') ? 'Plantar fasciitis (heel/arch)' : 'Foot soreness';
    case 'ankle':
      if (yes(a, 'pop')) return 'Possible Achilles tear';
      if (yes(a, 'rolled')) return 'Ankle sprain';
      return yes(a, 'stiffam') ? 'Achilles tendon irritation' : 'Ankle soreness';
    case 'knee':
      if (a.where === 'outside') return 'IT band irritation';
      if (a.where === 'front' || yes(a, 'stairs')) return "Runner's knee (pain around the kneecap)";
      return 'Knee soreness';
    case 'thigh': return yes(a, 'sudden') ? 'Muscle strain (pulled muscle)' : 'Thigh soreness';
    case 'hip':
      if (yes(a, 'groin') && yes(a, 'hop')) return 'Possible hip stress fracture';
      return yes(a, 'side') ? 'Outer hip tendon irritation' : 'Hip soreness';
    case 'back': return 'Low back strain';
    default: return null;
  }
}

export function triage(area: InjuryArea, answers: Record<string, Answer>): TriageResult {
  const qs = QUESTIONS[area];
  const redFlags: string[] = [];
  for (const q of qs) {
    const v = answers[q.id];
    if (q.redFlag === true && yes(answers, q.id)) redFlags.push(q.text);
    if (Array.isArray(q.redFlag) && typeof v === 'string' && q.redFlag.includes(v)) redFlags.push(q.text);
  }
  if (area === 'ankle' && answers.walk4 === false) redFlags.push('Can’t walk 4 steps without limping');
  if (area === 'hip' && yes(answers, 'groin') && yes(answers, 'hop')) redFlags.push('Groin pain that hurts when hopping');

  const pain = typeof answers.pain === 'number' ? answers.pain : 0;
  const worse = answers.warm === 'worse';
  const better = answers.warm === 'better';
  const morning = yes(answers, 'morning');
  const reasons: string[] = [`Pain ${pain}/10 while running`];
  if (worse) reasons.push('Gets worse as you warm up');
  if (better) reasons.push('Eases as you warm up');
  if (morning) reasons.push('Worse the next morning');

  let outcome: Outcome;
  if (redFlags.length || pain >= 7) outcome = 'stop';
  else if (pain >= 5 || worse || (area === 'thigh' && yes(answers, 'sudden'))) outcome = 'cross';
  else if (pain >= RULES.PAIN_OK || morning) outcome = 'easy';
  else outcome = 'run';

  const today = {
    run: 'Run as planned. Check in after.',
    easy: 'Run easy and about half the distance, on flat ground. Stop if pain goes above 3.',
    cross: 'Bike, pool, or elliptical for 30–40 minutes. Keep it easy. No running today.',
    stop: 'No running. See your athletic trainer or a doctor before you run again.',
  }[outcome];

  return {
    outcome,
    likely: likelyFor(area, answers),
    redFlags,
    reasons: redFlags.length ? redFlags : reasons,
    today,
    seeSomeoneIf: [
      'one spot on the bone hurts when you press it',
      'hopping on that leg hurts',
      'it hurts at night or when you rest',
      'you start to limp',
    ],
  };
}

// ── Comeback ladder ─────────────────────────────────────────────────
export interface Stage { n: number; title: string; minutes: number; detail: string }
export const STAGES: Stage[] = [
  { n: 1, title: 'Brisk walk', minutes: 30, detail: 'Walk 30 minutes at a quick pace.' },
  { n: 2, title: 'Run-walk', minutes: 20, detail: 'Run 2 min, walk 1 min. Flat, soft ground if you can.' },
  { n: 3, title: 'Run-walk', minutes: 25, detail: 'Run 4 min, walk 1 min.' },
  { n: 4, title: 'Run-walk', minutes: 30, detail: 'Run 9 min, walk 1 min.' },
  { n: 5, title: 'Easy run', minutes: 20, detail: 'Run 20 minutes without stopping, very easy.' },
  { n: 6, title: 'Easy run', minutes: 30, detail: 'Run 30 minutes without stopping, easy.' },
];

export interface InjuryStatus {
  injury: Injury;
  /** 'paused' = waiting for a clinician; 'cross' = cross-train until a good
   *  morning; 'easy' = run easy and short while it settles; 'comeback' = ladder. */
  mode: 'paused' | 'cross' | 'easy' | 'comeback';
  stage: Stage | null;
  goodDays: number;
  shouldAdvance: boolean;
  shouldResolve: boolean;
  headline: string;
  detail: string;
}

/** Days since `since` with a post-run check-in at or under the pain limit
 *  and no worse morning after. */
function goodDaysSince(checkins: CheckIn[], since: ISODate): number {
  const mornings = new Map(checkins.filter(c => c.moment === 'morning').map(c => [c.date, c.pain ?? 0]));
  const days = new Set<ISODate>();
  for (const c of checkins) {
    if (c.moment !== 'post_run' || c.date < since || c.pain == null) continue;
    const nextAm = mornings.get(addDays(c.date, 1));
    if (c.pain <= RULES.PAIN_OK && (nextAm == null || nextAm <= RULES.PAIN_OK)) days.add(c.date);
  }
  return days.size;
}

export function injuryStatus(injury: Injury, checkins: CheckIn[], today: ISODate): InjuryStatus {
  const since = injury.stageSince ?? injury.startedOn;
  const good = goodDaysSince(checkins, since);
  if (injury.outcome === 'stop' && !injury.clearedByClinician) {
    return {
      injury, mode: 'paused', stage: null, goodDays: 0, shouldAdvance: false, shouldResolve: false,
      headline: 'Running is paused',
      detail: 'See your athletic trainer or a doctor. When they clear you, tap “I’m cleared” and the comeback plan starts.',
    };
  }
  if (injury.outcome === 'easy' && injury.stage === 0) {
    const resolve = good >= 3 || today >= addDays(injury.startedOn, 7);
    return {
      injury, mode: 'easy', stage: null, goodDays: good, shouldAdvance: false, shouldResolve: resolve,
      headline: 'Easy days while it settles',
      detail: 'Runs are shorter and easy. After 3 good check-ins (pain 3 or less) you’re back to the full plan.',
    };
  }
  if (injury.stage === 0) {
    const mornings = checkins.filter(c => c.moment === 'morning' && c.date > injury.startedOn && (c.pain ?? 10) <= RULES.PAIN_FREE);
    return {
      injury, mode: 'cross', stage: null, goodDays: 0, shouldAdvance: mornings.length > 0, shouldResolve: false,
      headline: 'Cross-train for now',
      detail: 'When a morning check-in is 2 or less, the comeback plan starts.',
    };
  }
  const stage = STAGES[Math.min(injury.stage, STAGES.length) - 1];
  const done = good >= RULES.COMEBACK_GOOD_DAYS;
  return {
    injury, mode: 'comeback', stage, goodDays: good,
    shouldAdvance: done && injury.stage < STAGES.length,
    shouldResolve: done && injury.stage >= STAGES.length,
    headline: `${AREA_LABEL[injury.area]} comeback`,
    detail: `Move up a stage after ${RULES.COMEBACK_GOOD_DAYS} good days: pain 3 or less, and fine the next morning.`,
  };
}
