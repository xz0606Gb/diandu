#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把 contents + unit1~unit6 + tips 八个阅读器合并成一个连续大阅读器 book_reader/。

做法:
  - 按书本顺序拼接所有 pages;
  - 各单元的 pages/*.png 与 audio/*.mp3 复制进 book_reader/ 并加单元前缀重命名, 路径重写;
  - 合并各单元 translations 词典;
  - 复制增强版 index.html / app.js。

用法:
    python merge_reader.py
"""

import os, json, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
DST = os.path.join(HERE, "book_reader")
PAGES_DST = os.path.join(DST, "pages")
AUDIO_DST = os.path.join(DST, "audio")

# 书本顺序: 开头 contents -> unit1~6 -> 结尾 tips
UNITS = ["contents", "unit1", "unit2", "unit3", "unit4", "unit5", "unit6", "tips"]


def load_book(unit):
    p = os.path.join(HERE, f"{unit}_reader", "data.js")
    s = open(p, encoding="utf-8").read()
    i = s.index("{")
    j = s.rindex("}")
    return json.loads(s[i:j + 1])


def label_for(unit):
    """单元前缀 -> 引导里显示的标签。"""
    if unit == "contents":
        return "目录"
    if unit == "tips":
        return "知识贴士"
    if unit.startswith("unit"):
        return "Unit " + unit[4:]
    return unit


def copy_asset(unit, rel):
    """把 unit_reader/<rel> 复制为 book_reader/<dir>/<unit>_<base>, 返回新相对路径。"""
    d, base = rel.split("/", 1) if "/" in rel else ("", rel)
    newname = f"{unit}_{base}"
    src = os.path.join(HERE, f"{unit}_reader", rel)
    if not os.path.exists(src):
        return None
    dst = os.path.join(DST, d, newname)
    shutil.copy2(src, dst)
    return f"{d}/{newname}"


def main():
    os.makedirs(PAGES_DST, exist_ok=True)
    os.makedirs(AUDIO_DST, exist_ok=True)

    merged = {"pages": []}
    translations = {}
    nav = []

    for unit in UNITS:
        book = load_book(unit)
        merged.setdefault("voice", book.get("voice"))
        merged.setdefault("cnVoice", book.get("cnVoice"))
        merged.setdefault("dpi", book.get("dpi"))
        translations.update(book.get("translations", {}))

        start = len(merged["pages"])
        for pg in book["pages"]:
            # 页面图
            if pg.get("img"):
                pg["img"] = copy_asset(unit, pg["img"])
            # 自动分句音频
            for utt in pg.get("utts", []):
                if utt.get("a"):
                    utt["a"] = copy_asset(unit, utt["a"])
            # 手绘热区音频
            for r in pg.get("regions", []):
                if r.get("audio"):
                    r["audio"] = copy_asset(unit, r["audio"])
            merged["pages"].append(pg)
        if merged["pages"]:
            nav.append({"label": label_for(unit), "page": start})

    merged["translations"] = translations
    merged["nav"] = nav

    # 封面图(静态资源, 不随单元加前缀)
    cover_src = os.path.join(HERE, "封面.jpg")
    if os.path.exists(cover_src):
        shutil.copy2(cover_src, os.path.join(DST, "封面.jpg"))
        merged["cover"] = "封面.jpg"

    with open(os.path.join(DST, "data.js"), "w", encoding="utf-8") as f:
        f.write("const BOOK = ")
        json.dump(merged, f, ensure_ascii=False, indent=1)
        f.write(";\n")

    # 复制增强版前端
    for fn in ("index.html", "app.js"):
        src = os.path.join(HERE, fn)
        if os.path.exists(src):
            shutil.copy2(src, os.path.join(DST, fn))

    # 复制单词学习模块 words_reader 进 book_reader/（自包含，部署时不依赖 ../）
    words_src = os.path.join(HERE, "words_reader")
    words_dst = os.path.join(DST, "words_reader")
    if os.path.isdir(words_src):
        if os.path.exists(words_dst):
            shutil.rmtree(words_dst)
        shutil.copytree(words_src, words_dst)

    n_pages = len(merged["pages"])
    n_regions = sum(len(p.get("regions", [])) for p in merged["pages"])
    n_audio = len(os.listdir(AUDIO_DST))
    n_img = len(os.listdir(PAGES_DST))
    print(f"合并完成: {len(UNITS)} 个阅读器 -> book_reader/")
    print(f"  总页数: {n_pages} | 总热区: {n_regions} | 音频文件: {n_audio} | 页面图: {n_img}")
    print(f"  导航入口: {len(nav)} 个 {[n['label'] for n in nav]}")
    print(f"  封面: {'有 (' + merged['cover'] + ')' if merged.get('cover') else '无'}")
    print(f"  打开: file:///{DST}/index.html")


if __name__ == "__main__":
    main()
