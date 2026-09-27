// The tagline's sets beyond the season's own (docs/architecture.md, "Tagline"). Each set holds
// its lines per language, written for that language rather than translated, and shows only in
// the languages it has. Date and range sets have three lines, the third for the tagline's cue;
// period sets have two. A line can hold a placeholder such as `{hours}`, the same in every
// language. Several sets for one day take turns in the order they're listed here.
import type { Locale } from '~/paraglide/runtime.js'
import { type DateRule, days, mondayAfterLastSunday } from './rules'

export type Period = 'weekEnd' | 'monthEnd'

// `date`: the set replaces the tagline on those days. `range`: it joins the season's sets in
// the daily turn. `period`: it shows on a timesheet period's last days.
type TaglineWhen = { date: DateRule } | { range: DateRule } | { period: Period }

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
        'Sa ju ei taha alustada seda täitmata tundidega.',
        'Täida oma tunnileht.',
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
        'Tühja tunnilehe eest kommi ei saa.',
        'Sa ju ei tahaks, et keegi su sokki pissiks?',
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
]
