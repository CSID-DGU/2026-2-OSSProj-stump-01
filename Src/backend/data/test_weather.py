"""weather.py의 응답 정리 규칙 테스트. 실행: python -m unittest test_weather.py"""

import unittest
from datetime import date

from weather import default_range, to_weather


class ToWeatherTest(unittest.TestCase):
    def test_비가_오지_않은_날은_강수량_0(self):
        w = to_weather({"tm": "2026-08-01", "sumRn": "", "avgTa": "30.0", "maxTa": "34.0"})
        self.assertEqual(w.precipitation_mm, 0.0)
        self.assertEqual(w.region, "seoul")

    def test_최고기온_33도_이상이면_폭염(self):
        self.assertTrue(to_weather({"tm": "2026-08-01", "maxTa": "33.0"}).is_heatwave)
        self.assertFalse(to_weather({"tm": "2026-08-01", "maxTa": "32.9"}).is_heatwave)

    def test_기온이_비어_있으면_None이고_폭염_아님(self):
        w = to_weather({"tm": "2026-08-01", "sumRn": "12.5", "avgTa": "", "maxTa": ""})
        self.assertEqual(w.precipitation_mm, 12.5)
        self.assertIsNone(w.temp_max)
        self.assertFalse(w.is_heatwave)


class DefaultRangeTest(unittest.TestCase):
    def test_어제까지_365일(self):
        start, end = default_range(date(2026, 10, 20))
        self.assertEqual(end, date(2026, 10, 19))
        self.assertEqual((end - start).days + 1, 365)


if __name__ == "__main__":
    unittest.main()
