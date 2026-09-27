// The tagline's sets beyond the season's own (docs/architecture.md, "Tagline"). Each set holds
// its lines per language, written for that language rather than translated, and shows only in
// the languages it has. Date, range, and behaviour sets have three lines, the third for the
// tagline's cue; period sets have two. A line can hold a placeholder, the same in every
// language: `{hours}`, the running timer's whole hours, or `{days}`, the streak. Several sets
// that match take turns in the order they're listed here.
import type { Locale } from '~/paraglide/runtime.js'
import {
  type DateRule,
  type FillRule,
  all,
  dayOfYear,
  days,
  fridayThe13th,
  fromEaster,
  lastFilled,
  lastMonthFilled,
  lastWasEarlier,
  lastWasFriday,
  lastWasYesterday,
  lastWeekFilled,
  mondayAfterLastSunday,
  monthStart,
  streakOf,
  timerCapped,
  timerLong,
  timerOvernight,
} from './rules'

export type Period = 'weekEnd' | 'monthEnd'

// What the user's timesheet shows, in the order the pick tries them: a timer left running, 1–2
// empty working days, 3 or more, today and everything before it filled, and the days before
// filled but today not.
export type Behaviour = 'timer' | 'gap' | 'away' | 'praise' | 'andToday'

// `date`: the set replaces the tagline on those days. `range`: it joins the season's sets in
// the daily turn. `period`: it shows on a timesheet period's last days. `behaviour`: it shows
// when the fill summary shows that behaviour and the set's `if`, when it has one, matches.
type TaglineWhen =
  | { date: DateRule }
  | { range: DateRule }
  | { period: Period }
  | { behaviour: Behaviour; if?: FillRule }

export type TaglineSet = {
  id: string
  when: TaglineWhen
  lines: Partial<Record<Locale, string[]>>
}

export const TAGLINES: TaglineSet[] = [
  {
    id: 'new-year',
    when: { date: days('01-02', '01-04') },
    lines: {
      en: [
        'Happy New Year!',
        "You wouldn't want to start it with hours still missing.",
        'Fill in your timesheet.',
      ],
      et: [
        'Head uut aastat!',
        'Uut aastat ei alustata vanade võlgadega.',
        'Täida oma tunnileht ära.',
      ],
    },
  },
  {
    id: 'new-month',
    when: { date: monthStart },
    lines: {
      en: [
        'A new month.',
        "Last month's hours aren't coming with you.",
        'Log them before the books close.',
      ],
      et: [
        'Uus kuu, uus leht.',
        'Vana lehe tühjad read jäävad aga sinuga.',
        'Täida need ära, enne kui keegi küsima tuleb.',
      ],
    },
  },
  {
    id: 'valentines',
    when: { date: days('02-14') },
    lines: {
      en: [
        "It's Valentine's Day.",
        'Show your timesheet some love.',
        "Fill it in; it's all it ever asks for.",
      ],
      et: [
        'Täna on sõbrapäev.',
        'Ole oma tunnilehele hea sõber.',
        'Täida see ära, rohkem ta ei palugi.',
      ],
    },
  },
  {
    id: 'leap-day',
    when: { date: days('02-29') },
    lines: {
      en: [
        'An extra day this year.',
        "Make sure it's logged too.",
        'Fill in your timesheet; the next one is four years away.',
      ],
      et: [
        'Sel aastal on üks päev rohkem.',
        'Vaata, et ka see kirja saaks.',
        'Täida oma tunnileht, järgmist tuleb oodata neli aastat.',
      ],
    },
  },
  {
    id: 'shrove-tuesday',
    when: { date: fromEaster(-47) },
    lines: {
      et: [
        'Vastlapäeval lastakse liugu.',
        'Mida pikem liug, seda pikem lina.',
        'Pikka auku tunnilehes ei taha aga keegi. Täida see ära.',
      ],
    },
  },
  {
    id: 'pi-day',
    when: { date: days('03-14') },
    lines: {
      en: [
        'Pi is irrational.',
        "Your hours shouldn't be.",
        'Fill in your timesheet; 3.14 hours is a start.',
      ],
    },
  },
  {
    id: 'clocks-forward',
    when: { date: mondayAfterLastSunday('03') },
    lines: {
      en: [
        'The clocks went forward.',
        "Your timesheet deadline didn't.",
        'Fill it in before you lose another hour.',
      ],
      et: [
        'Kella keerati edasi.',
        'Aga mitte su tunnilehe tähtaega.',
        'Täida see, enne kui veel mõni tund kaob.',
      ],
    },
  },
  {
    id: 'april-fools',
    when: { date: days('04-01') },
    lines: {
      en: ['Your timesheet filled itself in.', 'April fool.', "It's still empty. Fill it in."],
      et: ['Su tunnileht täitis end ise ära.', 'Aprill!', 'See on ikka veel tühi. Täida see ära.'],
    },
  },
  {
    // Good Friday to Easter Monday, the working days around it.
    id: 'easter',
    when: { date: fromEaster(-2, 1) },
    lines: {
      en: [
        'The Easter eggs are hidden.',
        'So are some of your hours.',
        "Fill in your timesheet; nobody's hunting for those.",
      ],
      et: [
        'Munad on peidus.',
        'Mõned sinu tunnid samuti.',
        'Täida oma tunnileht ära – neid ei hakka keegi otsima.',
      ],
    },
  },
  {
    id: 'walpurgis',
    when: { date: days('04-30') },
    lines: {
      et: [
        'Täna öösel lendavad nõiad välja.',
        'Su tunnid on juba ammu lennanud.',
        'Püüa need kinni ja pane kirja.',
      ],
    },
  },
  {
    id: 'solstice',
    when: { date: days('06-21') },
    lines: {
      en: [
        'The longest day of the year.',
        'Log all of it.',
        'Fill in your timesheet while the sun is still up.',
      ],
      et: [
        'Käes on aasta pikim päev.',
        'Valgust jagub ka tunnilehe jaoks.',
        'Täida see ära, enne kui päike korraks loojub.',
      ],
    },
  },
  {
    id: 'before-midsummer',
    when: { date: days('06-22', '06-24') },
    lines: {
      et: [
        'Jaanituli ootab.',
        'Tunnileht ootab ka, ainult vähem kannatlikult.',
        'Sõnajalaõit otsid öösel, tunnid pane kirja kohe.',
      ],
    },
  },
  {
    id: 'midsummer',
    when: { date: days('06-25', '06-27') },
    lines: {
      et: [
        'Jaanid on peetud.',
        'Nüüd pane kirja ka tunnid.',
        'Täida oma tunnileht, enne kui lõkkesuits hajub.',
      ],
    },
  },
  {
    // The year's 256th day: 13 September, or 12 September in a leap year.
    id: 'programmers-day',
    when: { date: dayOfYear(256) },
    lines: {
      en: [
        "Day 256: Programmers' Day.",
        'Your timesheet says 0 hours.',
        "That's not an off-by-one error. Fill it in.",
      ],
      et: [
        'Aasta 256. päev: programmeerijate päev.',
        'Programmeerijad loevad nullist.',
        'Su tunnileht ei pea sinna kinni jääma. Täida see ära.',
      ],
    },
  },
  {
    id: 'friday-13th',
    when: { date: fridayThe13th },
    lines: {
      en: [
        'Friday the 13th.',
        'Something unlucky is coming.',
        "It's the deadline. Fill in your timesheet.",
      ],
      et: ['Reede ja 13.', 'Õnnetus on tulemas.', 'Selle nimi on tähtaeg. Täida oma tunnileht.'],
    },
  },
  {
    id: 'clocks-back',
    when: { date: mondayAfterLastSunday('10') },
    lines: {
      en: [
        'The clocks went back.',
        "Sadly, the deadline didn't.",
        "Fill in your timesheet; you've got the extra hour.",
      ],
      et: [
        'Kella keerati tagasi.',
        'Tähtaega kahjuks mitte.',
        'Täida oma tunnileht, lisatund sul selleks ju on.',
      ],
    },
  },
  {
    id: 'halloween',
    when: { date: days('10-31') },
    lines: {
      en: [
        'Something scary is lurking.',
        "It's your empty timesheet.",
        'Fill it in before your project manager comes to haunt you.',
      ],
      et: [
        'Midagi hirmsat varitseb.',
        'See on sinu tühi tunnileht.',
        'Täida see ära, enne kui projektijuht sind kummitama tuleb.',
      ],
    },
  },
  {
    id: 'all-souls',
    when: { date: days('11-02') },
    lines: {
      et: [
        'Hingedepäeval käivad hinged kodus.',
        'Su kirja panemata tunnid ekslevad veel ringi.',
        'Pane need kirja, et nad rahu leiaksid.',
      ],
    },
  },
  {
    id: 'st-martins',
    when: { date: days('11-10') },
    lines: {
      et: [
        'Mardipäev on käes.',
        'Ära sunni oma tunnilehte laulma.',
        'Täida see ruttu, sest viisi ta küll ei pea.',
      ],
    },
  },
  {
    id: 'st-catherines',
    when: { date: days('11-25') },
    lines: {
      et: [
        'Kadrisandid on ukse taga.',
        'Mardid käisid ka ja su tunnileht on ikka tühi.',
        'Täida see ära, enne kui kadrid laulma hakkavad.',
      ],
    },
  },
  {
    id: 'santa',
    when: { date: days('12-20', '12-23') },
    lines: {
      en: [
        'Santa is coming.',
        "He knows your hours aren't in.",
        'Fill in your timesheet before you land on the naughty list.',
      ],
      et: [
        'Jõuluvana tuleb.',
        'Ta teab, et su tunnid pole kirjas.',
        'Täida oma tunnileht, muidu saad vitsa.',
      ],
    },
  },
  {
    id: 'santa-verse',
    when: { date: days('12-20', '12-23') },
    lines: {
      et: [
        'Jõuluvana tuleb.',
        'Salmi asemel küsib ta tunnilehte.',
        'Täida see ära, enne kui ta uksele koputab.',
      ],
    },
  },
  {
    // Ahead of the month's end, 29–31 December, so the year's end names it.
    id: 'between-holidays',
    when: { date: days('12-27', '12-30') },
    lines: {
      en: [
        'Nobody is working this week.',
        'Your timesheet still is.',
        'Fill it in before the year runs out.',
      ],
      et: [
        'Pühade vahel ei tööta keegi.',
        'Välja arvatud sinu tunnileht.',
        'Täida see ära, enne kui aasta otsa saab.',
      ],
    },
  },
  {
    id: 'new-years-eve',
    when: { date: days('12-31') },
    lines: {
      en: [
        'Last chance this year.',
        "The fireworks can wait; your timesheet can't.",
        'Fill it in before midnight.',
      ],
      et: [
        'Aasta viimane päev.',
        'Ilutulestik võib oodata, tunnileht mitte.',
        'Täida see ära enne südaööd.',
      ],
    },
  },
  {
    id: 'holidays',
    when: { range: days('07-01', '07-31') },
    lines: {
      en: ['Out of office?', "Your timesheet isn't.", 'Fill it in before you switch off.'],
      et: ['Puhkusel?', 'Sinu tunnileht mitte.', 'Täida see ära, enne kui arvuti kinni paned.'],
    },
  },
  {
    id: 'school',
    when: { range: days('09-01', '09-30') },
    lines: {
      en: ['School is back.', 'The kids have homework.', 'So do you: fill in your timesheet.'],
      et: [
        'Kool algas.',
        'Mäletad veel, kuidas sa oma päevikut täitsid?',
        'Täida oma tunnileht korralikumalt!',
      ],
    },
  },
  {
    id: 'elves',
    when: { range: days('12-01', '12-19') },
    lines: {
      et: [
        'Päkapikud piiluvad aknast sisse.',
        'Tühja tunnilehe eest sussi sisse kommi ei saa.',
        'Täida see ära, muidu leiad sussist toore kartuli.',
      ],
    },
  },
  {
    id: 'week-end',
    when: { period: 'weekEnd' },
    lines: {
      en: ["It's Friday.", 'So is the deadline.'],
      et: ['On reede.', 'Täna kukub ka tähtaeg.'],
    },
  },
  {
    id: 'month-end',
    when: { period: 'monthEnd' },
    lines: {
      en: ['The month is almost out.', "Your hours shouldn't be."],
      et: ['Kuu saab kohe otsa.', 'Ära jäta tunde ripakile.'],
    },
  },
  {
    id: 'timer-cap',
    when: { behaviour: 'timer', if: timerCapped },
    lines: {
      en: [
        'Your timer gave up after {hours} hours.',
        "It's more committed than you.",
        'Fix the entry before payroll sees it.',
      ],
      et: [
        'Su taimer andis {hours} tunni järel alla.',
        'Temas on rohkem pühendumist kui sinus.',
        'Paranda kanne, enne kui raamatupidaja seda näeb.',
      ],
    },
  },
  {
    id: 'timer-night',
    when: { behaviour: 'timer', if: timerOvernight },
    lines: {
      en: ['Your timer worked all night.', 'Did you?', 'Stop it and fix the hours.'],
      et: [
        'Su taimer tegi öise vahetuse.',
        'Sina loodetavasti magasid.',
        'Peata see ja paranda tunnid ära.',
      ],
    },
  },
  {
    id: 'timer-long',
    when: { behaviour: 'timer', if: timerLong },
    lines: {
      en: ['Your timer has run for {hours} hours.', 'Have you?', "Stop it if you've gone home."],
      et: [
        'Su taimer on tiksunud juba {hours} tundi.',
        'Kas sina ka?',
        'Peata see, kui oled juba kodus.',
      ],
    },
  },
  {
    id: 'gap-yesterday',
    when: { behaviour: 'gap', if: lastWasYesterday },
    lines: {
      en: ['Yesterday is missing.', 'Did it happen?', 'Log it before you forget what you did.'],
      et: [
        'Eilne päev on puudu.',
        'Kas seda üldse oli?',
        'Pane see kirja, enne kui unustad, mida tegid.',
      ],
    },
  },
  {
    id: 'gap-friday',
    when: { behaviour: 'gap', if: lastWasFriday },
    lines: {
      en: [
        "The weekend's over.",
        "Friday's hours still aren't in.",
        'Log them before the week buries them.',
      ],
      et: [
        'Nädalavahetus on läbi.',
        'Reedesed tunnid ootavad ikka veel.',
        'Pane need kirja, enne kui uus nädal need enda alla matab.',
      ],
    },
  },
  {
    id: 'gap-day',
    when: { behaviour: 'gap', if: lastWasEarlier },
    lines: {
      en: [
        'A working day is missing.',
        "Your timesheet remembers, even if you don't.",
        'Log it before the gap grows.',
      ],
      et: [
        'Üks tööpäev on puudu.',
        'Tunnileht mäletab, isegi kui sina ei mäleta.',
        'Pane see kirja, enne kui auk suuremaks kasvab.',
      ],
    },
  },
  {
    id: 'welcome-back',
    when: { behaviour: 'away' },
    lines: {
      en: [
        'Welcome back.',
        'Your timesheet noticed you were gone.',
        'It kept the empty days for you.',
      ],
      et: [
        'Tere tulemast tagasi.',
        'Su tunnileht märkas, et sind polnud.',
        'Tühjad päevad hoidis ta sulle alles.',
      ],
    },
  },
  {
    id: 'caught-up',
    when: { behaviour: 'praise' },
    lines: {
      en: ['All caught up.', 'Suspicious.', "We'll find something tomorrow."],
      et: ['Kõik on kirjas.', 'Kahtlane.', 'Homme leiame midagi.'],
    },
  },
  {
    id: 'perfect',
    when: { behaviour: 'praise' },
    lines: {
      en: ['A perfect timesheet.', "Frame it; it won't last.", 'See you tomorrow at 9.'],
      et: [
        'Laitmatu tunnileht.',
        'Pane see või raami – kauaks see nii ei jää.',
        'Homme kell üheksa näeme.',
      ],
    },
  },
  {
    id: 'streak',
    when: { behaviour: 'praise', if: streakOf(5) },
    lines: {
      en: ['{days} days in a row.', "Don't ruin it now.", 'Tomorrow counts too.'],
      et: ['{days} päeva järjest.', 'Ära nüüd kõike ära riku.', 'Homne päev loeb ka.'],
    },
  },
  {
    id: 'filled-yesterday',
    when: { behaviour: 'andToday', if: all(lastFilled, lastWasYesterday) },
    lines: {
      en: [
        "Yesterday's hours are all in.",
        "Lovely. And today's?",
        "Don't let a {days}-day streak end here.",
      ],
      et: [
        'Eilsed tunnid on kõik kirjas.',
        'Tore. Aga tänased?',
        'Ära lase {days}-päevasel seerial siin katkeda.',
      ],
    },
  },
  {
    id: 'filled-friday',
    when: { behaviour: 'andToday', if: all(lastFilled, lastWasFriday) },
    lines: {
      en: ["Friday's hours are all in.", "Lovely. And today's?", 'Mondays count too.'],
      et: [
        'Reedesed tunnid on kõik kirjas.',
        'Tore. Aga tänased?',
        'Esmaspäevad lähevad ka arvesse.',
      ],
    },
  },
  {
    id: 'last-week',
    when: { behaviour: 'andToday', if: lastWeekFilled },
    lines: {
      en: ['Last week is complete.', 'This week has noticed.', 'It expects the same treatment.'],
      et: [
        'Eelmise nädala tunnid on koos.',
        'Uus nädal pani seda tähele.',
        'Ja ootab nüüd samasugust hoolt.',
      ],
    },
  },
  {
    id: 'last-month',
    when: { behaviour: 'andToday', if: lastMonthFilled },
    lines: {
      en: [
        'Last month is closed.',
        "Don't get used to the feeling.",
        "This one's already started.",
      ],
      et: ['Eelmine kuu on lukus.', 'Ära selle tundega liialt harju.', 'Uus on juba alanud.'],
    },
  },
]
