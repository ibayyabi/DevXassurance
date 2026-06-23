---
title: X-Assurance / X-Assistance PRD Addendum
status: draft
created: 2026-06-08
updated: 2026-06-08
---

# Addendum: Source Extraction and Deferred Detail

## Source Summary

Source: `C:/Users/kasyf/Downloads/[26-04] X-Assistance (Project_Assurance)-1.pdf`

The source deck positions the product as an AI Project Assurance Assistant for project management consulting. It emphasizes evidence-based insight, early warning, executive-ready reporting, and decision support from scattered project documents and data.

## Extracted Problem Statements

- Project control has many reports but often lacks timely insight into project health.
- Project information is manual and scattered across many documents.
- Risk visibility is reactive; problems often appear after intervention is late.
- Findings are difficult to validate with evidence.
- Project status is often overly optimistic.

## Extracted Product Positioning

The product does not replace human work. It assists PMC/PMO teams in evaluating project health based on evidence.

Target users named in the deck:

- Project Manager.
- PMO.
- Project Sponsor.
- Steering Committee.
- PMC Consultant.

## Extracted Core Capabilities

- Information Extraction.
- Document Summarization.
- Anomaly Detection.
- Report Generation.
- Decision Support System.
- Trend and Predictive Analytics.

## Architecture Notes From Source

Commercial MVP architecture:

- Input Layer: Project Evidence and Governance Reference.
- AI Processing Layer: ingestion/pre-processing, LLM/NLP engine, knowledge and data store.
- Output Layer: assurance engine, PMO dashboard, executive report.

Future development architecture:

- Analytics Layer: trend analysis and pattern recognition.
- Prediction and Recommendation Layer: predictive analysis model, root-cause analysis, recommendation engine.
- Data Layer: data warehouse, model and feature store.
- Output Layer: portfolio dashboard, strategic insight, alerts and notifications.

## Roadmap Notes From Source

- Prototype Validation: document upload, data extraction, basic anomaly check, demo insight.
- Commercial MVP: extraction improvements, summary and quick insight, basic health check for anomaly and gap detection, dashboard product.
- Product Enhancement: health report generation, decision support system, dashboard enhancement, PMO-ready assurance.
- Advanced Intelligence: trend analysis, predictive analytics, portfolio-level insight.

## Domain-Specific Relevance Notes

The source deck references relevance to the FPSO KNH project, including:

- Automatic extraction of claims, progress, and scope changes from FPSO project documents.
- Monthly IPA summaries supported by traceable source evidence.
- Detection of cost vs. progress vs. claim inconsistencies in reimbursement contracts.
- Structured IPA monthly reports for SKK Migas management.
- Data-backed decision support for SKK Migas - ENI forums.
- Predicting potential delay and cost escalation from historical project data.

These references are treated as evidence that the initial PRD should support oil-and-gas project assurance use cases, but not as confirmed binding implementation scope until stakeholders confirm the first pilot environment.
