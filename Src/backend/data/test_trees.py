"""trees.py의 행 정리 규칙 테스트. 실행: python -m unittest test_trees.py"""

import unittest

from trees import make_source_key, parse_address, to_tree


class ParseAddressTest(unittest.TestCase):
    def test_지번_주소에서_구와_동(self):
        self.assertEqual(parse_address("서울특별시 마포구 공덕동 111-129"), ("마포구", "공덕동"))

    def test_가로_끝나는_법정동(self):
        self.assertEqual(parse_address("서울특별시 성북구 보문동1가 178-1"), ("성북구", "보문동1가"))

    def test_도로명_주소는_구만(self):
        self.assertEqual(parse_address("서울특별시 종로구 경교장길 8"), ("종로구", None))

    def test_빈_주소(self):
        self.assertEqual(parse_address(None), (None, None))


class ToTreeTest(unittest.TestCase):
    def test_관리청과_위치_자치구가_다른_나무(self):
        row = ("용산구", "", "양버즘나무", "서울특별시 마포구 임정로 79",
               "서울특별시 마포구  공덕동 111-129", "126.9596431", "37.54608903")
        tree, reason = to_tree(row)
        self.assertIsNone(reason)
        self.assertEqual(tree.agency, "용산구")
        self.assertEqual((tree.district, tree.dong), ("마포구", "공덕동"))
        self.assertIsNone(tree.road_name)  # 빈 문자열은 None

    def test_주소가_없으면_관리_자치구로_대신(self):
        tree, _ = to_tree(("종로구", "", "은행나무", "", "", "126.97", "37.57"))
        self.assertEqual((tree.district, tree.dong), ("종로구", None))

    def test_관리청이_구가_아니고_주소도_없으면_구를_비움(self):
        tree, _ = to_tree(("서울시설공단", "", "회화나무", "", "", "127.06", "37.52"))
        self.assertIsNone(tree.district)

    def test_공분은_제외(self):
        tree, reason = to_tree(("노원구", "공릉로", "공분", "", "", "127.07", "37.62"))
        self.assertIsNone(tree)
        self.assertIn("공분", reason)

    def test_좌표_없음(self):
        self.assertEqual(to_tree(("중구", "", "소나무", "", "", "", None))[1], "좌표 없음")

    def test_서울_밖_좌표(self):
        self.assertEqual(to_tree(("중구", "", "소나무", "", "", "129.0", "35.1"))[1], "좌표가 서울 밖")

    def test_source_key는_좌표를_7자리로_맞춤(self):
        self.assertEqual(make_source_key("광진구", 127.097011099, 37.537904544), "광진구|127.0970111|37.5379045")


if __name__ == "__main__":
    unittest.main()
