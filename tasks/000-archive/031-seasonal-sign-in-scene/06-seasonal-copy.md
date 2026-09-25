# 06: Seasonal copy in the app

Status: done

The prototypes show one set of lines per season: the intro's four lines, whose first two are the
tagline at the foot of every page. `prototypes/seasons.js` also holds alternates per season and
taglines for the last days of a timesheet period, which the app should use too. The full list is
in `prototypes/README.md` ("Seasonal copy").

## Acceptance criteria

- [x] The app keeps the copy in one module that the sign-in page and the app frame share, with
      each season's lines, its alternates, and the period taglines.
- [x] How the app picks among a season's sets is decided, for example a different set per visit
      or per week, so the tagline doesn't wear out.
- [x] The period taglines replace the season's in a period's last days, once timesheet periods
      exist: "It's Friday. So is the deadline." at the end of the week, "The month is almost out.
      Your hours shouldn't be." at the end of the month.
- [x] The tagline shows at the foot of every signed-in page and the sign-in page, over a fade.
- [x] The copy is translatable (task 012), with the line pairs kept together.
