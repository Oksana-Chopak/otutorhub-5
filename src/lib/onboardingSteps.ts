// A11: дані кроків онбордингу — окремо від важкого компонента, щоб банер і
// бейдж «Новий!» брали ЄДИНУ правду про кількість core-кроків без роздування бандла.
export interface StepProgress {
  hasSubject: boolean;
  hasStudent: boolean;
  hasLesson: boolean;
  hasAvailability: boolean;
  hasReferral: boolean;
  hasMeetingUrl: boolean;
  hasChat: boolean;
  hasPaidLesson: boolean;
  hasDebtAnswer: boolean;
  hasPaymentRules: boolean;
  hasAutoCompleteChoice: boolean;
  hasGoogleCalendar: boolean;
  hasTelegram: boolean;
}

export interface StepDef {
  id: number; emoji: string;
  group: "essential" | "setup" | "bonus";
  action: string; xp: number;
  title: string; desc: string; cta: string; hint: string;
  autoKey?: keyof StepProgress;
}

export const ALL_STEPS: StepDef[] = [
  { id:0, emoji:"📚", group:"essential", action:"subject",      xp:25,  title:"step.subject.title",      desc:"step.subject.desc",      cta:"step.subject.cta",    hint:"step.subject.hint",      autoKey:"hasSubject" },
  { id:1, emoji:"👋", group:"essential", action:"student",      xp:50,  title:"step.student.title",      desc:"step.student.desc",      cta:"step.student.cta",    hint:"step.student.hint",      autoKey:"hasStudent" },
  { id:2, emoji:"📅", group:"essential", action:"lesson",       xp:75,  title:"step.lesson.title",       desc:"step.lesson.desc",       cta:"step.lesson.cta",     hint:"step.lesson.hint",       autoKey:"hasLesson" },
  /* Крок «гроші» стоїть ТРЕТІМ, одразу після першого уроку, і це навмисно.
     Без нього перша сесія закінчується словами «профіль заповнено», а фінанси
     лишаються порожніми, поки не мине місяць — тобто цінність приходить
     ПІЗНО, а рішення платити треба ухвалити РАНО. Репетитор носить суму
     боргів у голові вже сьогодні; запитати про неї — найдешевший спосіб
     зробити продукт корисним у перший день. Хабовому не показуємо: розрахунки
     з учнями веде школа (HUB_SKIP). */
  { id:13,emoji:"💸", group:"essential", action:"debt",         xp:75,  title:"step.debt.title",         desc:"step.debt.desc",         cta:"step.debt.cta",       hint:"step.debt.hint",         autoKey:"hasDebtAnswer" },
  { id:3, emoji:"🔔", group:"setup",     action:"proRules",     xp:75,  title:"step.proRules.title",     desc:"step.proRules.desc",     cta:"step.proRules.cta",   hint:"step.proRules.hint",     autoKey:"hasPaymentRules" },
  { id:4, emoji:"✅", group:"setup",     action:"autoMark",     xp:50,  title:"step.autoMark.title",     desc:"step.autoMark.desc",     cta:"step.autoMark.cta",   hint:"step.autoMark.hint",     autoKey:"hasAutoCompleteChoice" },
  { id:5, emoji:"🕐", group:"bonus",     action:"availability", xp:75,  title:"step.availability.title", desc:"step.availability.desc", cta:"step.availability.cta", hint:"step.availability.hint", autoKey:"hasAvailability" },
  { id:6, emoji:"📲", group:"setup",     action:"telegram",     xp:75,  title:"step.telegram.title",     desc:"step.telegram.desc",     cta:"step.telegram.cta",   hint:"step.telegram.hint",     autoKey:"hasTelegram" },
  { id:7, emoji:"🎁", group:"bonus",     action:"referral",     xp:100, title:"step.referral.title",     desc:"step.referral.desc",     cta:"step.referral.cta",  hint:"step.referral.hint",     autoKey:"hasReferral" },
  { id:8, emoji:"🎥", group:"bonus",     action:"zoom",         xp:50,  title:"step.zoom.title",         desc:"step.zoom.desc",         cta:"step.zoom.cta",      hint:"step.zoom.hint",         autoKey:"hasMeetingUrl" },
  { id:9, emoji:"💬", group:"bonus",     action:"chat",         xp:50,  title:"step.chat.title",         desc:"step.chat.desc",         cta:"step.chat.cta",      hint:"step.chat.hint",         autoKey:"hasChat" },
  { id:10,emoji:"💰", group:"bonus",     action:"finance",      xp:100, title:"step.finance.title",      desc:"step.finance.desc",      cta:"step.finance.cta",   hint:"step.finance.hint",      autoKey:"hasPaidLesson" },
  { id:11,emoji:"📆", group:"bonus",     action:"calendar",     xp:75,  title:"step.calendar.title",     desc:"step.calendar.desc",     cta:"step.calendar.cta",  hint:"step.calendar.hint",     autoKey:"hasGoogleCalendar" },
  { id:12,emoji:"✨", group:"bonus",     action:"ai",           xp:150, title:"step.ai.title",           desc:"step.ai.desc",           cta:"step.ai.cta",     hint:"step.ai.hint" },
];

export const CORE  = ALL_STEPS.filter(s => s.group !== "bonus");
export const CORE_TOTAL = CORE.length;
