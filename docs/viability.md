# DeepBridge: viability

## Problem

A research founder can explain the technology yet struggle to identify who inside a company might buy it. Public papers reveal technical work and research relationships, but turning them into a buyer shortlist and a credible introduction takes manual work.

DeepBridge connects those steps: form a buyer hypothesis, inspect public signals, trace an evidenced research path, and prepare an introduction request for human review. The demo tests that workflow with cached Lightmatter research. It does not establish demand or sales conversion.

## Who pays

The proposed customer is an early-stage deep-tech company whose founder still leads sales. Its founder or commercial lead would pay to reduce time spent researching accounts and finding a relevant route into them. University commercialization teams and accelerators are possible portfolio customers, subject to customer discovery.

The buying test is practical: does the team find relevant buyer conversations faster, with less manual research? A pilot should measure research time per accepted account, paths the founder confirms are usable, and introductions the founder chooses to request. Revenue and conversion claims need observed results; the demo's seeded pipeline is simulated.

## Pricing through credits

The proposed offer is a subscription with an included credit allowance and optional credit packs. Credits would pay for costly enrichment and draft preparation; checking an existing source should remain easy. Prices and allowances need validation against provider cost and willingness to pay, so no commercial price is claimed here.

Today, the local demo starts with five credits. Draft requests consume credits, insufficient balance returns HTTP 402, and `/credits` shows the balance and event history. This is a working gate, not a connected billing system.

The planned Flexprice integration would meter usage, read the customer's wallet balance, and apply the same gate. Candidate events are lead enrichment, draft generation, and graph evaluation. Event names, charge timing, retries, and refunds must be settled before billing customers. There is no message-sending feature to meter.

## Why research networks

Generic lead lists can identify a company or job title. A research network can add a specific reason to approach someone: a shared paper, time in the same lab, or related technical work. That context may help a founder judge whether an introduction is appropriate and write a more relevant request.

This is the product hypothesis, not a proven performance advantage. A co-author link proves shared publication credit; it does not prove friendship, current contact, or willingness to introduce. Lab relationships also need evidence. DeepBridge makes the source, date, and weakest hop visible so the founder can decide whether a path is useful.

An initial comparison should use the same target accounts for a generic-list workflow and an evidence-backed research workflow. Compare time spent, buyer relevance, and founder-confirmed usable paths before claiming better outcomes.

## Risks and next tests

| Risk | What must be tested or addressed |
|---|---|
| Research interest may not imply buying intent | Ask prospective customers to assess suggested accounts against an actual purchasing problem and budget owner. |
| Names collide and affiliations become stale | Keep human name checks, dated affiliations, and separate current-role verification; test ambiguous names. |
| Research ties may be weak or unusable | Ask founders to confirm each proposed bridge and record why a path is rejected. |
| Coverage varies by field and company | Test beyond the cached photonics case, including companies with little public research. Arbitrary-founder graph generation is still planned. |
| Live provider latency and cost can erase margin | Measure cost per accepted account and draft, enforce task limits, and distinguish cached replay from live results. |
| Generated text can overstate evidence | Retain evidence validation, exact-text approval, and the rule that nothing is sent. |
| Billing is incomplete | Verify Flexprice metering, wallet reconciliation, and failure handling before charging users. |
| Public profile data still creates privacy obligations | Minimize retained contact data and define access, deletion, and retention practices before a customer pilot. |

The next commercial milestone is a small founder pilot with agreed success measures. The demo demonstrates the review workflow; paid demand and repeatable sales outcomes remain to be validated.
