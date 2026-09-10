# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary user: a field service engineer, writing up an account of a hospital visit after
leaving the site (post-visit, not mid-visit), on a laptop. They routinely observe the installed
base of medical equipment during visits — what's there, roughly how old it is, who made it —
but today that knowledge stays as an unstructured note or in memory.

## Product Purpose

Turns a field colleague's free-text account of a hospital visit into a structured,
evidence-backed installed-base record of the medical equipment they saw (MR, CT, ultrasound,
X-ray, patient monitoring, image-guided therapy). Success means the structured record
faithfully preserves what was actually said — including hedges, contradictions, and declared
unknowns — rather than silently overwriting it with what a form required.

## Positioning

Extraction runs entirely on-device through QVAC: no observation text ever crosses the network,
and capture/extraction keep working in airplane mode once the model is cached locally. The
product treats human uncertainty as a first-class value rather than noise to be resolved —
hedged, approximate, ranged, and contradictory statements are preserved and surfaced as
questions, never silently resolved by message order or turned into confident facts. Duplicate
and corroboration detection is a transparent, versioned, scored heuristic (not an embedding
black box), so a reviewer can always see why a candidate was flagged, and nothing merges
automatically.

## Operating Context

- Desktop Electron app; UI is in Spanish (the primary user's working language), while project
  documentation is in English.
- This is a hackathon prototype, evaluated in a 5-minute judged demo. Scoring rubric: Technical
  35% (genuine use of QVAC with on-device/delegated P2P inference and implementation quality),
  Innovation 25%, Impact 20%, Design 10% (UX/interface), Completion 10% (functional
  demonstration and finish). QVAC/on-device inference is central to the product, not a
  decorative AI feature — the UI should communicate technical credibility, trust, operational
  usefulness, and product maturity very quickly within that short window.
- Workflow: conversational free-text capture (English or Spanish) → local structured
  extraction → one deterministic follow-up question at a time for missing/ambiguous fields →
  explicit human review and confirmation before anything saves → append-only evidence →
  projected into a per-facility Customer 360 view and a Dashboard rolled up by modality and
  country. Possible duplicates/corroborations across visits are queued for human resolution,
  never auto-merged.
- Uses only synthetic data (the official 20-record "Dummy Installed Base" challenge dataset,
  13 visits across 13 facilities/cities/10 countries, six fictional brands) — no real patient,
  hospital, or Philips product data anywhere.

## Capabilities and Constraints

- All extraction runs locally via `@qvac/sdk`; no cloud AI provider exists in the dependency
  graph, and there is no silent fallback to one. A labelled deterministic mock exists for
  fast iteration but is explicitly not valid for the final demo, and the UI always discloses
  which engine actually ran.
- Confidence is an explainable `confidence-v1` strategy with evidence IDs, not a bare number.
- Approximate ages are preserved as exact, estimated, ranged, qualitative, or unknown — never
  collapsed to a guessed number; numeric installation-date estimates are derived only when the
  reported age supports it, and are marked `Derived`.
- Multiple equipment groups, multiple modalities, and multiple ages within one visit are all
  supported in a single capture.
- A contradiction inside one capture (e.g. a brand named then corrected) is surfaced as a
  question, never silently resolved by message order.
- Neither current model (600M or 4B) yet meets the project's own stated extraction quality bar
  — this is a disclosed, open limitation, not a finished accuracy claim.
- Voice/STT and Photo evidence are typed extension seams only — not implemented, not claimed to
  be.
- No freshness/aging policy is defined yet; Dashboard aging values are intentionally left
  unclassified rather than guessed.
- No authentication, multi-user sync, or automatic entity merging — out of scope for this
  vertical slice.

## Brand Commitments

Product name: **Lua**.
Positioning: Local intelligence for hospital equipment observations.

Lua is the public-facing name and visual identity (logo, banner) for this hackathon
prototype; it is not an official Philips product, and no Philips logos, colors, or brand
assets exist in the repository to preserve. The npm package name
(`philips-customer-installed-base-intelligence`) is a leftover internal identifier kept
unchanged deliberately, so Electron's default userData directory (and any local SQLite
database already created under it) does not silently move; it is never shown to a user or
judge. "Philips" may still appear in supporting documentation where it names or contextualizes
the challenge dataset.

## Evidence on Hand

- The official 20-record "Dummy Installed Base" synthetic dataset is bundled and seeded
  (`npm run seed`); no other real content, testimonials, or case studies exist and none should
  be fabricated.
- No brand/logo/visual assets exist in the repository yet.
- Recorded corpus-eval numbers exist for both models (see README "Measured results") — real
  measurements from a synthetic-corpus run, not a clinical or general-purpose benchmark.

## Product Principles

1. Preserve what was actually said — hedges, contradictions, and declared unknowns are data,
   never noise to be resolved away.
2. Nothing is saved without an explicit human confirmation of a plain-language summary; the
   system asks, it does not assume.
3. Evidence is append-only and traceable — corrections and later visits add to the record, they
   never overwrite or silently merge it.
4. On-device inference is the product's core credibility claim, not a background implementation
   detail, and the demo must make that visible.
5. Given the 5-minute judged-demo context, the interface must read as trustworthy and
   production-credible at a glance, not merely functional.

## Accessibility & Inclusion

No project-specific accessibility requirement has been established beyond standard web
practice; not yet confirmed with the user.
