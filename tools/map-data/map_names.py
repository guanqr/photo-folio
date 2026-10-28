# -*- coding: utf-8 -*-
"""足迹地图省/国名映射（唯一源）。

- PROVINCE_NAMES：繁→简省名（站点 location → provinces.json 键）
- COUNTRY_NAMES：站点地点名 → Natural Earth admin-0 英文名

generate-maps.py 直接 import 本文件，并生成
themes/photofolio/assets/js/map-names.js 供渲染端 import。
新增省/国拍摄地只改这里，再运行生成器（--names-only 可只刷新 JS）。
"""

PROVINCE_NAMES = {
    "廣東": "广东省",
    "浙江": "浙江省",
    "雲南": "云南省",
    "安徽": "安徽省",
    "福建": "福建省",
    "江西": "江西省",
    "上海": "上海市",
    "天津": "天津市",
    "青海": "青海省",
    "內蒙古": "内蒙古自治区",
}

COUNTRY_NAMES = {
    "日本": "Japan",
}
