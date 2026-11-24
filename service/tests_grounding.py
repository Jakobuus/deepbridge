"""Run with uv run python -m unittest -v tests_grounding."""

import subprocess
import unittest
from io import BytesIO
from unittest.mock import patch


class GroundingTests(unittest.TestCase):
    def test_quotes_must_match_contiguous_text_in_the_named_source(self):
        from app.lanes.jakob.grounding import ground

        sources = {
            "paper": "The ﬁlm’s gain—measured at\n\troom temperature—rose. More trials followed.",
            "notes": "The measured gain doubled.",
        }
        items = [
            {"source_id": "paper", "quote": "FILM'S gain-measured at room temperature", "text": "Gain"},
            {"source_id": "paper", "quote": "The measured gain doubled."},
            {"source_id": "paper", "quote": "The ﬁlm’s gain\nMore trials followed."},
            {"source_id": "paper", "quote": "\n\u200b "},
            {"source_id": "missing", "quote": "The measured gain doubled."},
        ]
        kept, dropped = ground(items, sources)
        self.assertEqual(kept, items[:1])
        self.assertEqual([item["quote"] for item in dropped], [item["quote"] for item in items[1:]])
        self.assertTrue(all(item["reason"] for item in dropped))
        self.assertTrue(all("reason" not in item for item in items))

    def test_model_output_is_validated_and_grounded(self):
        from app.lanes.jakob.grounding import extract_claims

        model_output = """```json
        {"items": [
            {"text": "The trial finished.", "quote": "We completed the trial."},
            {"text": "The trial finished.", "quote": "WE COMPLETED THE TRIAL."},
            {"text": "The trial succeeded.", "quote": "We proved it works."},
            {"text": 12, "quote": "We completed the trial."}
        ]}
        ```"""
        with patch("app.lanes.jakob.grounding.run_claude", return_value=model_output):
            claims = extract_claims("paper", "We completed the trial.", "Founder briefing")
        self.assertEqual(claims, [
            {"source_id": "paper", "text": "The trial finished.", "quote": "We completed the trial."},
        ])

    def test_invalid_model_json_returns_no_claims(self):
        from app.lanes.jakob.grounding import extract_claims

        with patch("app.lanes.jakob.grounding.run_claude", return_value="no JSON"):
            self.assertEqual(extract_claims("paper", "A readable source.", "Briefing"), [])


class PdfTests(unittest.TestCase):
    def test_pdf_bytes_use_metadata_and_cap_text(self):
        from pypdf import PdfWriter
        from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

        from app.lanes.jakob.pdftext import pdf_text

        writer = PdfWriter()
        writer.add_metadata({"/Title": "Measurements"})
        page = writer.add_blank_page(width=100, height=100)
        font = DictionaryObject({
            NameObject("/Type"): NameObject("/Font"),
            NameObject("/Subtype"): NameObject("/Type1"),
            NameObject("/BaseFont"): NameObject("/Helvetica"),
        })
        page[NameObject("/Resources")] = DictionaryObject({
            NameObject("/Font"): DictionaryObject({NameObject("/F1"): font}),
        })
        content = DecodedStreamObject()
        content.set_data(b"BT /F1 10 Tf (" + b"x" * 70_000 + b") Tj ET")
        page.replace_contents(content)
        file = BytesIO()
        writer.write(file)
        document = pdf_text(file.getvalue())
        self.assertEqual(document["title"], "Measurements")
        self.assertEqual(len(document["text"]), 60_000)
        self.assertEqual(set(document["text"]), {"x"})

    def test_rejects_oversized_bytes(self):
        from app.lanes.jakob.pdftext import pdf_text

        with self.assertRaisesRegex(ValueError, "15 MB"):
            pdf_text(bytes(15 * 1024 * 1024 + 1))

    def test_worker_timeout_is_reported(self):
        from app.lanes.jakob.pdftext import pdf_text

        with patch("app.lanes.jakob.pdftext.subprocess.run",
                   side_effect=subprocess.TimeoutExpired("pdf", 20)):
            with self.assertRaisesRegex(TimeoutError, "20 seconds"):
                pdf_text(b"%PDF-")

    def test_live_arxiv_pdf(self):
        from app.lanes.jakob.grounding import ground
        from app.lanes.jakob.pdftext import pdf_text

        url = "https://arxiv.org/pdf/1706.03762"
        document = pdf_text(url)
        self.assertIn(document["title"], ("1706.03762", "Attention Is All You Need"))
        self.assertIn("Attention Is All You Need", document["text"])
        self.assertGreater(len(document["text"]), 10_000)
        self.assertLessEqual(len(document["text"]), 60_000)
        items = [
            {"source_id": url, "quote": "based solely on attention mechanisms"},
            {"source_id": url, "quote": "based solely on recurrent mechanisms"},
        ]
        kept, dropped = ground(items, {url: document["text"]})
        self.assertEqual(kept, items[:1])
        self.assertEqual(len(dropped), 1)
        print(f"\nLive PDF: Attention Is All You Need | title field {document['title']}"
              f" | {len(document['text']):,} characters"
              f" | retained {len(kept)}, rejected {len(dropped)}", flush=True)
