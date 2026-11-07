#!/usr/bin/env python3
"""Deterministic unit tests for the independent OOXML reader primitives.

No workbook is opened, no network, no .env, no API key.
"""
import unittest

import ooxml_reader as reader


class DateTests(unittest.TestCase):
    def test_1900_serial_epoch(self):
        self.assertEqual(reader.excel_serial_to_iso("1", False), "1900-01-01")
        self.assertEqual(reader.excel_serial_to_iso("59", False), "1900-02-28")

    def test_1900_leap_bug_serial_60_is_invalid(self):
        self.assertIsNone(reader.excel_serial_to_iso("60", False))
        self.assertEqual(reader.excel_serial_to_iso("61", False), "1900-03-01")

    def test_1904_epoch(self):
        self.assertEqual(reader.excel_serial_to_iso("0", True), "1904-01-01")
        self.assertEqual(reader.excel_serial_to_iso("1", True), "1904-01-02")

    def test_negative_and_non_numeric_are_invalid(self):
        self.assertIsNone(reader.excel_serial_to_iso("-1", False))
        self.assertIsNone(reader.excel_serial_to_iso("not-a-number", False))


class FormatTests(unittest.TestCase):
    def test_percent_formats(self):
        self.assertTrue(reader.is_percent_format("0%"))
        self.assertTrue(reader.is_percent_format("0.00%"))
        self.assertTrue(reader.is_percent_format("0.0%;0.0%"))
        # A negative section is not a plain percentage section, so it is not
        # treated as proven scaling (mirrors the production parser).
        self.assertFalse(reader.is_percent_format('0.0%;[Red]-0.0%'))
        self.assertFalse(reader.is_percent_format('"%"0'))
        self.assertFalse(reader.is_percent_format("0"))
        self.assertFalse(reader.is_percent_format("yyyy-mm-dd"))

    def test_date_formats(self):
        self.assertTrue(reader.is_date_format("yyyy-mm-dd h:mm:ss"))
        self.assertTrue(reader.is_date_format("dd\\-mmm\\-yyyy"))
        self.assertTrue(reader.is_date_format("m/d/yy"))
        self.assertFalse(reader.is_date_format("0%"))
        self.assertFalse(reader.is_date_format(None))


class FormulaCacheTests(unittest.TestCase):
    def test_not_formula(self):
        self.assertEqual(reader.classify_formula(False, "n", True, "1"), ("not_formula", None))

    def test_missing_cache(self):
        self.assertEqual(reader.classify_formula(True, "n", False, ""), ("missing_cache", None))

    def test_cached_empty_is_not_zero(self):
        self.assertEqual(reader.classify_formula(True, "n", True, ""), ("cached_empty", None))

    def test_cached_error(self):
        self.assertEqual(reader.classify_formula(True, "e", True, "#DIV/0!"), ("cached_error", "error"))

    def test_cached_value(self):
        self.assertEqual(reader.classify_formula(True, "n", True, "0.25"), ("cached_value", "number"))
        self.assertEqual(reader.classify_formula(True, "str", True, "text"), ("cached_value", "string"))

    def test_unknown_type(self):
        self.assertEqual(reader.classify_formula(True, "weird", True, "x"), ("unknown", None))


class ColumnTests(unittest.TestCase):
    def test_column_letters(self):
        self.assertEqual(reader.column_letters(1), "A")
        self.assertEqual(reader.column_letters(26), "Z")
        self.assertEqual(reader.column_letters(27), "AA")
        self.assertEqual(reader.column_letters(32), "AF")

    def test_column_number(self):
        self.assertEqual(reader.column_number("A5"), 1)
        self.assertEqual(reader.column_number("AF12"), 32)
        self.assertEqual(reader.column_number(""), 0)


if __name__ == "__main__":
    unittest.main()
