# Reuse existing document parsing for PMO assurance

The new PMO assurance design reuses the existing upload, parser/OCR, source-located chunks, and text groups. It replaces the assurance-specific classification and generic extraction with document/section context and PMO-domain contracts, then updates the existing Assurance result. It does not create a permanent parallel upload/parser/assurance pipeline. This avoids duplicate processing and preserves the current parsing and source-location behavior; validation of parsed values and evidence contracts happens in the new assurance path.
