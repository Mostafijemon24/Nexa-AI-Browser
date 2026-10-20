import { compileRules, parseFilterList, type CompiledRules, type FilterRule } from '../../shared/protection'

/**
 * NEXA-authored starter rule set (Adblock-subset syntax).
 *
 * These are plain domain facts (well-known advertising / analytics / tracking /
 * annoyance endpoints), authored for NEXA — not a redistributed copy of any
 * third-party filter list. See NEXA_P3_FILTER_ENGINE_DECISION.md. The set is
 * intentionally compact and honest; external list updates are NOT CONFIGURED in
 * this slice.
 */

const TRACKERS = `
! NEXA tracker rules
||google-analytics.com^
||analytics.google.com^
||ssl.google-analytics.com^
||googletagmanager.com^
||googletagservices.com^
||stats.g.doubleclick.net^
||mixpanel.com^
||api.mixpanel.com^
||segment.io^
||segment.com^$third-party
||cdn.segment.com^
||amplitude.com^
||api.amplitude.com^
||hotjar.com^
||static.hotjar.com^
||heapanalytics.com^
||cdn.heapanalytics.com^
||fullstory.com^
||matomo.cloud^
||scorecardresearch.com^
||sb.scorecardresearch.com^
||quantserve.com^
||quantcount.com^
||chartbeat.com^
||static.chartbeat.com^
||newrelic.com^$third-party
||nr-data.net^
||bat.bing.com^
||snowplowanalytics.com^
||branch.io^$third-party
||mparticle.com^
`

const SOCIAL_TRACKERS = `
! NEXA social-tracking rules
||connect.facebook.net^
||facebook.com/tr^
||platform.twitter.com^
||analytics.twitter.com^
||ads-twitter.com^
||linkedin.com/li/track^
||px.ads.linkedin.com^
||pinterest.com/ct^
`

const ADS = `
! NEXA advertising rules
||doubleclick.net^
||googlesyndication.com^
||pagead2.googlesyndication.com^
||adservice.google.com^
||googleadservices.com^
||adnxs.com^
||adsystem.com^
||amazon-adsystem.com^
||advertising.com^
||adform.net^
||criteo.com^
||criteo.net^
||rubiconproject.com^
||pubmatic.com^
||openx.net^
||taboola.com^
||outbrain.com^
||media.net^
||sharethrough.com^
||smartadserver.com^
||spotxchange.com^
||teads.tv^
||moatads.com^
||adroll.com^
||yieldmo.com^
||3lift.com^
||casalemedia.com^
||bidswitch.net^
||gumgum.com^
`

const ANNOYANCES = `
! NEXA annoyance rules (network-level only; cosmetic filtering NOT CONFIGURED)
||onesignal.com^$third-party
||cdn.onesignal.com^
||pushcrew.com^
||pushengage.com^
||wonderpush.com^
||izooto.com^
||taboola.com^$third-party
||propellerads.com^
||popads.net^
||poptm.com^
`

let cached: CompiledRules | null = null
let cachedRules: FilterRule[] | null = null

export function bundledRules(): FilterRule[] {
  if (cachedRules) return cachedRules
  cachedRules = [
    ...parseFilterList(TRACKERS, 'tracker'),
    ...parseFilterList(SOCIAL_TRACKERS, 'tracker'),
    ...parseFilterList(ADS, 'ad'),
    ...parseFilterList(ANNOYANCES, 'annoyance')
  ]
  return cachedRules
}

export function bundledCompiled(): CompiledRules {
  if (cached) return cached
  cached = compileRules(bundledRules())
  return cached
}

/** Human-readable metadata for the Settings → Filter lists panel. */
export function bundledListInfo() {
  const rules = bundledRules()
  const byCat = { tracker: 0, ad: 0, annoyance: 0 }
  for (const r of rules) {
    if (r.category === 'tracker') byCat.tracker++
    else if (r.category === 'ad') byCat.ad++
    else if (r.category === 'annoyance') byCat.annoyance++
  }
  return [
    { id: 'nexa-trackers', name: 'NEXA Trackers', rules: byCat.tracker, active: true },
    { id: 'nexa-ads', name: 'NEXA Ads', rules: byCat.ad, active: true },
    { id: 'nexa-annoyances', name: 'NEXA Annoyances', rules: byCat.annoyance, active: true }
  ]
}
