import type { CatalogDetails } from '../types/satellite-data'

/**
 * Turns the CelesTrak satellite catalog's short codes into words for the info panel.
 *
 * Tables are from celestrak.org/satcat/sources.php and launchsites.php (read
 * 2026-11-16), with some names shortened to fit the panel, plus three codes seen in the
 * data but not on that page (JOR, KWT, SVK). A code that isn't in a
 * table is shown as it is, so a new owner or launch site is never hidden.
 */

const OWNERS: Readonly<Record<string, string>> = {
  AB: 'Arabsat',
  ABS: 'Asia Broadcast Satellite',
  AC: 'AsiaSat',
  ALG: 'Algeria',
  ANG: 'Angola',
  ARGN: 'Argentina',
  ARM: 'Armenia',
  ASRA: 'Austria',
  AUS: 'Australia',
  AZER: 'Azerbaijan',
  BEL: 'Belgium',
  BELA: 'Belarus',
  BERM: 'Bermuda',
  BGD: 'Bangladesh',
  BHR: 'Bahrain',
  BHUT: 'Bhutan',
  BOL: 'Bolivia',
  BRAZ: 'Brazil',
  BUL: 'Bulgaria',
  BWA: 'Botswana',
  CA: 'Canada',
  CHBZ: 'China and Brazil',
  CHTU: 'China and Türkiye',
  CHLE: 'Chile',
  CIS: 'Russia / CIS (former USSR)',
  COL: 'Colombia',
  CRI: 'Costa Rica',
  CZCH: 'Czech Republic',
  DEN: 'Denmark',
  DJI: 'Djibouti',
  ECU: 'Ecuador',
  EGYP: 'Egypt',
  ESA: 'European Space Agency',
  ESRO: 'European Space Research Organization',
  EST: 'Estonia',
  ETH: 'Ethiopia',
  EUME: 'EUMETSAT',
  EUTE: 'Eutelsat',
  FGER: 'France and Germany',
  FIN: 'Finland',
  FR: 'France',
  FRIT: 'France and Italy',
  GER: 'Germany',
  GHA: 'Ghana',
  GLOB: 'Globalstar',
  GREC: 'Greece',
  GRSA: 'Greece and Saudi Arabia',
  GUAT: 'Guatemala',
  HRV: 'Croatia',
  HUN: 'Hungary',
  IM: 'Inmarsat',
  IND: 'India',
  INDO: 'Indonesia',
  IRAN: 'Iran',
  IRAQ: 'Iraq',
  IRID: 'Iridium',
  IRL: 'Ireland',
  ISRA: 'Israel',
  ISRO: 'Indian Space Research Organisation',
  ISS: 'International Space Station partners',
  IT: 'Italy',
  ITSO: 'Intelsat',
  JOR: 'Jordan',
  JPN: 'Japan',
  KAZ: 'Kazakhstan',
  KEN: 'Kenya',
  KWT: 'Kuwait',
  LAOS: 'Laos',
  LKA: 'Sri Lanka',
  LTU: 'Lithuania',
  LUXE: 'Luxembourg',
  MA: 'Morocco',
  MALA: 'Malaysia',
  MCO: 'Monaco',
  MDA: 'Moldova',
  MEX: 'Mexico',
  MMR: 'Myanmar',
  MNE: 'Montenegro',
  MNG: 'Mongolia',
  MUS: 'Mauritius',
  NATO: 'NATO',
  NETH: 'Netherlands',
  NICO: 'New ICO',
  NIG: 'Nigeria',
  NKOR: 'North Korea',
  NOR: 'Norway',
  NPL: 'Nepal',
  NZ: 'New Zealand',
  O3B: 'O3b Networks',
  ORB: 'Orbcomm',
  PAKI: 'Pakistan',
  PERU: 'Peru',
  POL: 'Poland',
  POR: 'Portugal',
  PRC: 'China',
  PRY: 'Paraguay',
  PRES: 'China and the European Space Agency',
  QAT: 'Qatar',
  RASC: 'RascomStar-QAF',
  ROC: 'Taiwan',
  ROM: 'Romania',
  RP: 'Philippines',
  RWA: 'Rwanda',
  SAFR: 'South Africa',
  SAUD: 'Saudi Arabia',
  SDN: 'Sudan',
  SEAL: 'Sea Launch',
  SEN: 'Senegal',
  SES: 'SES',
  SGJP: 'Singapore and Japan',
  SING: 'Singapore',
  SKOR: 'South Korea',
  SLB: 'Solomon Islands',
  SPN: 'Spain',
  STCT: 'Singapore and Taiwan',
  SVK: 'Slovakia',
  SVN: 'Slovenia',
  SWED: 'Sweden',
  SWTZ: 'Switzerland',
  TBD: 'To be determined',
  THAI: 'Thailand',
  TMMC: 'Turkmenistan and Monaco',
  TUN: 'Tunisia',
  TURK: 'Türkiye',
  UAE: 'United Arab Emirates',
  UK: 'United Kingdom',
  UKR: 'Ukraine',
  UNK: 'Unknown',
  URY: 'Uruguay',
  US: 'United States',
  USBZ: 'United States and Brazil',
  VAT: 'Vatican City',
  VENZ: 'Venezuela',
  VTNM: 'Vietnam',
  ZWE: 'Zimbabwe',
}

const LAUNCH_SITES: Readonly<Record<string, string>> = {
  AFETR: 'Cape Canaveral, Florida, USA',
  AFWTR: 'Vandenberg, California, USA',
  ANDSP: 'Andøya Spaceport, Norway',
  ALCLC: 'Alcântara Launch Center, Brazil',
  BOS: 'Bowen Orbital Spaceport, Australia',
  CAS: 'Canaries airspace (air launch)',
  DLS: 'Dombarovskiy, Russia',
  ERAS: 'Eastern Range airspace (air launch)',
  FRGUI: 'Kourou, French Guiana',
  HGSTR: 'Hammaguira, Algeria',
  JJSLA: 'Jeju Island sea launch area, South Korea',
  JSC: 'Jiuquan, China',
  KODAK: 'Kodiak, Alaska, USA',
  KSCUT: 'Uchinoura Space Center, Japan',
  KWAJ: 'Kwajalein Atoll',
  KYMSC: 'Kapustin Yar, Russia',
  NSC: 'Naro Space Center, South Korea',
  PLMSC: 'Plesetsk, Russia',
  RLLB: 'Rocket Lab, Mahia Peninsula, New Zealand',
  SCSLA: 'South China Sea launch area',
  SEAL: 'Sea Launch platform',
  SEMLS: 'Semnan, Iran',
  SMTS: 'Shahrud, Iran',
  SNMLP: 'San Marco platform, Kenya',
  SPKII: 'Space Port Kii, Japan',
  SRILR: 'Satish Dhawan Space Centre, India',
  STARB: 'Starbase, Texas, USA',
  SUBL: 'Submarine launch',
  SVOBO: 'Svobodnyy, Russia',
  TAISC: 'Taiyuan, China',
  TANSC: 'Tanegashima Space Center, Japan',
  TYMSC: 'Baikonur Cosmodrome, Kazakhstan',
  UNK: 'Unknown',
  VOSTO: 'Vostochny Cosmodrome, Russia',
  WLPIS: 'Wallops Island, Virginia, USA',
  WOMRA: 'Woomera, Australia',
  WRAS: 'Western Range airspace (air launch)',
  WSC: 'Wenchang, China',
  XICLF: 'Xichang, China',
  YAVNE: 'Yavne, Israel',
  YSLA: 'Yellow Sea launch area',
  YUN: 'Sohae, North Korea',
}

const OBJECT_TYPES: Readonly<Record<string, string>> = {
  PAY: 'Payload',
  'R/B': 'Rocket body',
  DEB: 'Debris',
  UNK: 'Unknown',
}

const STATUSES: Readonly<Record<string, string>> = {
  '+': 'Operational',
  '-': 'Not operational',
  P: 'Partially operational',
  B: 'Backup or standby',
  S: 'Spare',
  X: 'Extended mission',
  D: 'Decayed',
  '?': 'Unknown',
}

export interface DetailRow {
  label: string
  value: string
}

const longDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'long', timeZone: 'UTC' })

/** "20 November 1998" (in the viewer's language), or the raw text if it isn't a date. */
function formatLaunchDate(isoDate: string): string {
  const ms = Date.parse(`${isoDate}T00:00:00Z`)
  return Number.isNaN(ms) ? isoDate : longDate.format(ms)
}

/**
 * The rows to show for one satellite, in display order. Fields the catalog doesn't
 * have are left out, so the result is empty for a satellite with no details.
 */
export function describeCatalogDetails(details: CatalogDetails): DetailRow[] {
  const rows: DetailRow[] = []
  if (details.OWNER !== undefined) rows.push({ label: 'Owner', value: OWNERS[details.OWNER] ?? details.OWNER })
  if (details.LAUNCH_DATE !== undefined) rows.push({ label: 'Launched', value: formatLaunchDate(details.LAUNCH_DATE) })
  if (details.LAUNCH_SITE !== undefined) {
    rows.push({ label: 'Launch site', value: LAUNCH_SITES[details.LAUNCH_SITE] ?? details.LAUNCH_SITE })
  }
  if (details.OBJECT_TYPE !== undefined) {
    rows.push({ label: 'Type', value: OBJECT_TYPES[details.OBJECT_TYPE] ?? details.OBJECT_TYPE })
  }
  if (details.OPS_STATUS_CODE !== undefined) {
    rows.push({ label: 'Status', value: STATUSES[details.OPS_STATUS_CODE] ?? details.OPS_STATUS_CODE })
  }
  return rows
}
