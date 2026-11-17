# Data Contract

The JSON file the pipeline produces and the app reads. TypeScript types for it live in `src/types/` and must match this doc.

| File | Where | In git? |
|---|---|---|
| `public/data/satellites.json` | Written by `npm run fetch-data` or `pull-live-data`; served at `/data/satellites.json` | No (`.gitignore`) |
| `public/data/sample.json` | Small hand-picked sample, same schema | Yes |

## Source

CelesTrak GP data, queried as `https://celestrak.org/NORAD/elements/gp.php?GROUP=<group>&FORMAT=JSON`. The JSON is CCSDS OMM keywords. Fetch rules are in [CelesTrak fair use](ci-cd.md#celestrak-fair-use).

| Group | Used for |
|---|---|
| `active` | All satellites shown (10k+). Every record comes from here. |
| `stations` | Tag only |
| `gps-ops` | Tag only |
| `weather` | Tag only |

Catalog details (owner, launch date, launch site, object type, status) come from the CelesTrak satellite catalog (SATCAT), queried as `https://celestrak.org/satcat/records.php?GROUP=active&FORMAT=JSON`, at most once per 24 hours. See [Catalog details](#catalog-details).

## Schema (version 1)

```jsonc
{
  "schemaVersion": 1,
  "generatedAt": "2026-11-16T18:23:05Z",   // UTC, when the pipeline fetched the data
  "source": "CelesTrak GP",
  "count": 10234,                            // == satellites.length
  "catalogCheckedAt": "2026-11-16T18:23:05Z", // optional: when the SATCAT was last asked for
  "groups": {                                // group name -> NORAD catalog IDs
    "stations": [25544, 48274],
    "starlink": [44713, 44714],
    "gps-ops": [24876],
    "weather": [33591]
  },
  "satellites": [
    {
      "OBJECT_NAME": "ISS (ZARYA)",
      "OBJECT_ID": "1998-067A",
      "NORAD_CAT_ID": 25544,
      "EPOCH": "2026-11-16T12:01:23.456789",
      "MEAN_MOTION": 15.50103472,
      "ECCENTRICITY": 0.0006703,
      "INCLINATION": 51.6416,
      "RA_OF_ASC_NODE": 247.4627,
      "ARG_OF_PERICENTER": 130.536,
      "MEAN_ANOMALY": 325.0288,
      "EPHEMERIS_TYPE": 0,
      "CLASSIFICATION_TYPE": "U",
      "ELEMENT_SET_NO": 999,
      "REV_AT_EPOCH": 49999,
      "BSTAR": 0.00025,
      "MEAN_MOTION_DOT": 0.00001,
      "MEAN_MOTION_DDOT": 0,
      "OWNER": "ISS",                        // the five fields below are optional
      "LAUNCH_DATE": "1998-11-20",
      "LAUNCH_SITE": "TYMSC",
      "OBJECT_TYPE": "PAY",
      "OPS_STATUS_CODE": "+"
    }
  ]
}
```
(Values in the example are illustrative.)

### Notes

- **Satellite records keep CelesTrak's OMM field names unchanged,** so they can go straight to satellite.js's OMM parser (confirm the exact function name for the installed satellite.js version in M3) and stay comparable with the source. Only the fields above are kept; others are dropped to save size.
- **Units are OMM's:** `MEAN_MOTION` in revolutions/day, angles in degrees, `EPOCH` in UTC without a `Z` suffix (parse as UTC).
- **`NORAD_CAT_ID` is the unique key.** Treat it as a number. 6-digit catalog numbers (above 99999) already appear in CelesTrak's JSON as plain numbers and need no special handling here: alpha-5 encoding only exists in the fixed-width TLE text format, which we don't use.

### Catalog details

- `OWNER`, `LAUNCH_DATE`, `LAUNCH_SITE`, `OBJECT_TYPE` and `OPS_STATUS_CODE` are copied from the SATCAT record with the same `NORAD_CAT_ID`, with the SATCAT's field names and codes unchanged. The app turns codes into words (`src/composables/catalogDetails.ts`) and shows an unknown code as it is.
- **All five are optional,** per record and per field. A satellite missing from the SATCAT, or a field that fails validation (a code of 1 to 8 characters, a `YYYY-MM-DD` date, a known object type), is simply left out. Adding optional fields did not change the schema version.
- `catalogCheckedAt` is when the pipeline last asked for the SATCAT, whether or not it worked. The next request is made no sooner than 24 hours later. In between, and after a failed request, details are carried over from the file that is live.
- A SATCAT problem never blocks the orbital data: the run still deploys, with the previous details and a warning on the workflow run.

### Groups

- `stations`, `gps-ops`, `weather`: NORAD IDs from those CelesTrak group responses, kept only if the ID is also in `active`.
- `starlink`: IDs from `active` whose `OBJECT_NAME` starts with `STARLINK`. We don't fetch the `starlink` group because it's a subset of `active` and CelesTrak asks us not to download both.
- A satellite can be in more than one group. Satellites in no group still show under "All".

## Validation

The fetch script must pass all checks before writing the file. Any failure means no file and no deploy.

- [ ] Every request returned HTTP 200 with a JSON array.
- [ ] `active` has at least 5,000 records.
- [ ] If a live file exists, `active` count is at least 80% of the live count (catches partial responses).
- [ ] Every kept record has all required fields above with the right types; records missing them are dropped. If more than 1% are dropped, fail.
- [ ] No duplicate `NORAD_CAT_ID` (duplicates are dropped and logged).
- [ ] `stations` contains the ISS (25544).
- [ ] Each tag group is non-empty.
- [ ] `count === satellites.length`.

The app also checks `schemaVersion` on load and shows an error state if it doesn't recognize it.

## Changing the contract

Any breaking change bumps `schemaVersion`, updates this doc, the types in `src/types/`, `sample.json` and the fetch script in the same PR.
