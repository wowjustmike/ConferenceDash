/** Bump when the rules change so earlier rule-made exclusions are re-checked. */
export const CLASSIFIER_VERSION = 3

export type Kind = 'conference' | 'trade_show' | 'expo' | 'convention' | 'fan_con'
export type Classification = { kind: Kind } | { excluded: string } | { unknown: true }

const t = (re: RegExp, s: string) => re.test(s)

const FAIRE = /\b(renaissance|ren)\s+(faire|fair|festival)\b|\bfaire\b/i
const FESTIVAL = /\b(music|food|wine|beer|film|arts?|jazz|rock|blues|country|craft)\s+festival\b|\b(coachella|lollapalooza|bonnaroo|burning man|electric daisy)\b/i
const CONCERT = /\b(concert|symphony|orchestra|dj set|live in concert|world tour)\b/i
const SPORTS = /\b(nfl|nba|mlb|nhl|mls|wnba|ufc|wwe|super bowl|championships?|tournament|marathon|grand prix|playoffs?|rodeo|boxing|wrestling|cheer(leading)?|futsal|bowl game|volleyball|fencing|gymnastics|bjj|jiu[- ]?jitsu|table tennis|hyrox|grand nation\w*|nationals|\w*qualifier|aau|usav|jnq|5k|classic|drill team|dance\/drill)\b|\b(tournamen|champi)\w*/i
// Youth dance and Irish-dance competitions call themselves "conventions"; they are checked before the professional words.
const COMPETITION = /\b(dance (convention|competition|nationals)|talent competition|dancefest|danceone|feis|winterfeis|oireachtas)\b/i
const SOCIAL = /\b(party|wedding|banquet|gala|reunion|graduation|quincea\w+|prom|birthday|fundraiser|holiday celebration|luncheon|dinner|breakfast|masked ball|ball|cotillion|beautillion|feast|awards)\b/i
const SHOW = /\b(an evening with|cirque|film tour|(holiday|craft|christmas) market)\b|\bart \+ craft market\b/i

const FAN_CON = /\b(comic[- ]?con|comiccon|fan ?expo|anime|manga|cosplay|collect-a-con|dragon ?con|gen ?con|otakon|pax)\b/i
const TRADE_SHOW = /\btrade ?show\b|\b[a-z]+ show\b/i
const EXPO = /\bexpo(sition)?\b/i
const CONVENTION = /\bconvention\b/i
// Words that make something a professional event even when it also contains a sports/music/festival word ("Boxing Industry Expo").
const PRO = /\b(conference|conf|summit|symposium|congress|forum|expo|exposition|convention|trade ?show|industry)\b/i
const CONFERENCE = /\b[a-z]*(conf|conference|summit|symposium|congress|forum)\b|\b(black hat|def con|kubecon|re:invent|reinvent|sxsw|dreamforce|money20\/20|cloud next|devfest|jsnation|mjbizcon|cybersecuritycon)\b|\bcon\b/i
// CamelCase "...Con" brands (KubeCon, PyCon, MJBizCon) but not words that merely end in -con (Beacon).
const CAMEL_CON = /\b[A-Za-z]*[a-z]Con\b/

export function classifyKind(name: string, hint = ''): Classification {
  const s = `${name} ${hint}`
  if (t(COMPETITION, s)) return { excluded: 'competition' }
  if (!t(PRO, s)) {
    if (t(SHOW, s)) return { excluded: 'performance' }
    if (t(FAIRE, s)) return { excluded: 'faire' }
    if (t(FESTIVAL, s)) return { excluded: 'festival' }
    if (t(CONCERT, s)) return { excluded: 'concert' }
    if (t(SPORTS, s)) return { excluded: 'sports' }
  }
  if (t(FAN_CON, s)) return { kind: 'fan_con' }
  if (t(CONVENTION, s)) return { kind: 'convention' }
  if (t(EXPO, s)) return { kind: 'expo' }
  if (t(TRADE_SHOW, s)) return { kind: 'trade_show' }
  if (t(CONFERENCE, s) || t(CAMEL_CON, s)) return { kind: 'conference' }
  if (t(SOCIAL, s)) return { excluded: 'social' }
  if (/\bces\b|\bnab\b/i.test(s)) return { kind: 'trade_show' }
  return { unknown: true }
}

export function inWindow(ev: { start_date: string; end_date: string }, w: { start: string; end: string }): boolean {
  return ev.start_date <= w.end && ev.end_date >= w.start
}
