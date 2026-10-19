# Retrieval And Ranking Spec

## Purpose

This document defines the intended retrieval and ranking behavior for the AIRI Memory Lab benchmark and any future production-oriented memory system derived from it. The goal is to make candidate generation, fusion, reranking, and evidence selection auditable as first-class architecture rather than leaving them scattered across run notes and chat logs.

This is a living specification. Some behaviors described here are already present in current benchmark tracks, while others are design targets that still need implementation or validation.

This document intentionally avoids prematurely locking the project into one favored retrieval algorithm. Retrieval mechanics are considered researcher-owned. The purpose of this spec is to define constraints, priorities, interfaces, and observability requirements rather than dictate one permanent formula.

## Scope

This spec covers:

- query analysis
- retrieval surfaces
- search plans
- candidate fusion
- reranking
- evidence selection
- category-aware context assembly

This spec does not fully define:

- memory extraction prompts
- memory schema details
- benchmark scoring
- production service APIs

Those belong in separate documents.

## Current Architectural Intent

The system should not behave like a single static search query over a flat memory pool. Retrieval should be plan-based, question-aware, and category-aware.

The intended pipeline is:

1. Analyze the question.
2. Derive a focus query and question signals.
3. Build multiple search plans.
4. Execute searches against the available memory store.
5. Merge candidates across plans.
6. Rank candidates using fused signals rather than any single score.
7. Select evidence with explicit coverage and diversity constraints.
8. Assemble category-shaped context for answer generation.

At the same time, this pipeline should be understood as an internal implementation pattern rather than a product-level promise. The product-facing concept is simpler:

- a question arrives
- the memory system is queried
- the system returns evidence suitable for answering

If multiple search attempts happen after that, those should generally be treated as higher-level agent behavior rather than a required property of the core retrieval primitive.

## Product Constraints

The retrieval stack exists to serve a narrow use case:

- one user
- one character
- occasional references to third parties, recurring entities, or ongoing situations

This is not a general enterprise search problem. The spec should remain grounded in the actual AIRI interaction loop rather than drift into overly abstract retrieval theory.

## Success Criteria

Success for retrieval and ranking should be evaluated primarily by product usefulness, with benchmark performance retained as a research lens.

The three core deliverables this stack should support are:

1. More meaningful consciousness-stream artifacts in STMM logs, including tags, pills, or other semantic traces interspersed with recap-style memory blocks.
2. Better agent-driven semantic search, where the system returns meaningful evidence that an agent can interpret rather than relying on brittle keyword lookup.
3. Better mixed stream presentation in the live chat log, where memory artifacts and tags can improve the feel and readability of ongoing memory output.

Benchmark gains are still valuable, but they are not the only or even final success condition.

## Retrieval Objectives

The retrieval system should optimize for the following:

- preserve literal precision for single-hop and temporal questions
- widen recall for multi-hop questions without drowning the context in noise
- support abstraction for open-domain questions without letting abstraction contaminate direct factual answers
- preserve temporal evidence as structured retrieval support rather than only raw text
- remain debuggable at the plan and evidence level

## Core Retrieval Surfaces

The archive currently points to a multi-field retrieval model even when implementations differ. The intended searchable surfaces are:

- `fact`
- `observed_text`
- `subject`
- `temporal_marker`
- `room`
- `resolved_date`
- `who`
- `what`
- `where`
- `why`

Not every search plan should hit every field. The default rule should be narrow search first, broader surfaces only when the question type justifies them.

For this project, `subject` should be interpreted simply as:

- the person
- entity
- topic
- or recurring situation

that a memory is mainly about.

This remains important even in a narrow one-user / one-character system because conversations frequently reference other people, relationships, places, projects, and prior events.

The `room` concept should not be treated as a core product concept. It originated as a memory-palace-style topical bucket. In this project it should be treated as optional experimental metadata unless future evidence shows it is materially useful.

## Query Analysis

Before retrieval, the system should derive structured signals from the user question.

Expected outputs:

- normalized raw query
- focus query
- entity list
- time terms
- quoted spans
- likely subject
- question category
- primary dimension
- abstraction need
- causal or descriptive intent

## Suggested Question Signals

Useful signals include:

- `isTemporalQuestion`
- `isWhyQuestion`
- `isDescribeQuestion`
- `isLatestQuestion`
- `isOrderingQuestion`
- `isComparisonQuestion`
- `hasQuotedPhrase`
- `hasExplicitName`
- `hasRelativeTime`
- `needsAbstraction`

These signals should shape search plans and ranking priors. They should not become brittle hard gates unless a category truly requires it.

## Search Plans

The intended design is multi-pass retrieval with purpose-built search plans instead of one wide blind search.

Baseline plans:

- `base_fact`
- `focus_fact`
- `subject_focus`
- `observed_cue`

Temporal plans:

- `temporal_event`
- `temporal_fact`
- `timeline_support`

Multi-hop plans:

- `bridge_fact`
- `bridge_focus`
- `subquestion_support`
- `cross_session_support`

Open-domain plans:

- `session_summary`
- `profile_summary`
- `abstraction_support`

Causal plans:

- `why_support`
- `reason_surface`

## Plan Execution Rules

The intended rules are:

- every question gets at least one narrow fact-oriented plan
- temporal questions must receive temporal plans
- open-domain questions must be allowed to retrieve summaries
- multi-hop questions should receive broader candidate union than single-hop questions
- bridge questions (`bridge_relational` or `c1_multihop` with low noun salience) execute `bridge_focus`:
  1. Inspect Turn N-1 context (assistant reply + Turn N-1 grounded facts/claims from durable chat session).
  2. Perform fast cognitive referent resolution (System-1 Jev choice/noul) to bind anaphoras (e.g. "that item" -> "crystal").
  3. Formulate a targeted Hop-2 focus query incorporating the bound referent before executing the primary memory candidate retrieval.
- room and taxonomy signals may bias plans, but should not hard-filter the search universe by default

## Candidate Fusion

Candidate fusion should merge all hits by stable record identity and preserve plan-local metadata.

Per candidate, the system should preserve:

- source record
- matched plans
- per-plan rank
- per-plan raw score
- matched fields
- any local boosts or priors applied

This is necessary because reranking should consider not only score magnitude, but also how a record surfaced.

## Ranking Signals

The ranking layer should combine multiple independent signals.

Recommended signal families:

- vector similarity
- lexical or BM25 score
- focus-query similarity
- keyword overlap
- predicate overlap
- entity overlap
- quoted phrase overlap
- temporal relevance
- room affinity
- subject match
- dimension match
- confidence score
- record-kind prior
- cross-plan reciprocal rank fusion

## Rank Fusion Strategy

The preferred ranking approach is weighted reciprocal rank fusion or an equivalent multi-signal fusion strategy.

Rationale:

- one score is rarely reliable across all question classes
- lexical and dense retrieval fail differently
- plan-specific ranks carry useful evidence even when raw scores are not directly comparable
- category priors can be layered on top without replacing the base signals

## Category Priors

The archive strongly implies category-aware reranking.

Expected priors:

- `c4 single-hop`: facts and events preferred, summaries limited
- `c2 temporal`: events, dated records, and time-bearing evidence preferred
- `c1 multi-hop`: cross-session and complementary evidence preferred
- `c3 open-domain`: summaries and profile-level abstractions allowed, but still anchored to evidence

## Evidence Selection

After ranking, the system should not just take top K blindly. Evidence selection should apply explicit constraints.

Recommended constraints:

- total evidence budget per category
- per-session cap
- per-kind cap
- near-duplicate suppression
- minimum cross-session diversity for multi-hop
- timeline-shape enforcement for temporal
- summary support for open-domain when available

The preferred evidence philosophy is balanced mix rather than one-note retrieval. Evidence packs should ideally avoid becoming:

- all literal duplicates
- all summaries
- all same-session variants
- all one abstraction level

## Context Assembly

The prompt context should be shaped by question category.

Category intents:

- `c4 single-hop`: short literal evidence list
- `c2 temporal`: timeline ordering with resolved or relative date cues
- `c1 multi-hop`: complementary fact chain, not duplicated variants
- `c3 open-domain`: evidence-first plus summary-backed abstraction support

## Deep Dives

### Deep Dive: Facts vs Observations

The archive now points toward a dual-view memory model:

- `fact` as the clean retrieval surface
- `observed_text` as provenance-rich context

This suggests retrieval should remain anchored on clean semantic records while still letting nuanced phrasing influence ranking and answer generation.

### Deep Dive: Summaries

Summaries should not flood every question type. They are most justified for:

- open-domain characterization
- selected multi-hop bridging
- profile-level interpretation

They should be a support layer, not a universal replacement for primary evidence.

### Deep Dive: Room Taxonomy

Room logic appears useful as a soft signal and potentially as a planning hint. It appears risky as a hard pre-filter. The current design intent should therefore treat rooms as:

- a reranking feature
- a query hint
- a debugging signal

and not as an exclusive search gate unless future evidence strongly supports it.

## Considerations

- retrieval quality and answer quality are linked, but not identical
- broader retrieval increases recall but may harm answer exactness
- summary-heavy prompts may improve LLM judgment while hurting token-level F1
- ranking should favor evidence complementarity, not just raw relevance
- any future learned ranker must remain debuggable enough to replace current heuristics responsibly
- retrieval experimentation should not be constrained by premature algorithm dogma
- current benchmark work is last-mile research on top of an already useful semantic search system, not a precondition for having something shippable

## Debug And Observability Requirements

Heavy debug is a first-class requirement for this retrieval stack.

Every run should emit a dated artifact folder containing, best effort:

- question analysis outputs
- raw search inputs
- query rewrites or search plan variants
- retrieved candidate pools
- selected evidence
- rejected evidence when useful
- synthesized summary pools where relevant
- assembled answer context
- raw prompts
- raw model outputs
- final answer
- judge output
- router and yapper traces
- failure logs
- empty retrieval attempts

The goal is not only to inspect final answers, but to inspect the full flow of information through the system across a compute session.

Artifacts should be organized per run. More granular per-question artifacts may exist inside those run folders, but the top-level archival unit should be the run itself.

## Pending Decisions

- Should every question generate a focus query, or only when confidence is high?
- Should subject detection be purely heuristic or LLM-assisted?
- Should `observed_text` be searched directly in all categories or only in special plans?
- Should temporal questions use separate event records by default?
- How many summaries should be allowed into final context for `c3` and `c1`?
- Should room affinity remain purely a rerank feature, or influence search plan generation more strongly?
- Should future production retrieval preserve the same plan names and debug structure as the benchmark?

The following decisions are currently considered settled enough for this draft:

- retrieval algorithms remain researcher-owned
- multiple follow-up searches are agent-loop behavior, not a required property of the base retrieval function
- `subject` remains core metadata
- `room` remains optional experimental metadata
- heavy debug is mandatory
- product usefulness takes priority over benchmark maximization

## Open Problems

- rank fusion weights remain hand-tuned rather than learned
- evidence selection still risks overfitting to benchmark category behavior
- open-domain retrieval may require a stronger interpretation layer than summaries alone
- multi-hop retrieval still lacks a fully explicit chain-construction model

## Proposed Next Iteration

The next stable version of this spec should include:

- canonical search plan names
- exact per-category evidence budgets
- explicit fusion formula examples
- a debug trace schema
- a map from retrieval plans to benchmark categories

## Status

Status: Draft

This document is intended to be the central retrieval reference for future runs. It should be updated whenever a run materially changes plan construction, ranking signals, or evidence selection rules.
