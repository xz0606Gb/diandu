#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把 unit1translator.md 的翻译批量填进 data.js。

匹配策略: 英文做归一化(去空格/标点/小写)后再比对，兼容 OCR 把词连写的情况
(SchoolGlubs / Footballclub / sports.club 等)。

用法:
    python fill_translations.py          # 默认 unit1: 读 unit1translator.md -> unit1_reader/data.js
    python fill_translations.py 2        # 处理 unit2translator.md -> unit2_reader/data.js
"""
import os, re, sys, json

HERE = os.path.dirname(os.path.abspath(__file__))
UNIT = sys.argv[1] if len(sys.argv) > 1 else "1"
ID = f"unit{UNIT}" if UNIT.isdigit() else UNIT
OUT = os.path.join(HERE, f"{ID}_reader")
DATA = os.path.join(OUT, "data.js")
TR = os.path.join(HERE, f"{ID}translator.md")

def norm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())

def clean_cn(s):
    s = re.sub(r"（[^）]*）", "", s)   # 全角译注 （...）
    s = re.sub(r"\([^)]*\)", "", s)     # 半角译注 (...)
    return s.strip()

def parse_translations():
    d = {}
    for raw in open(TR, encoding="utf-8"):
        line = raw.strip()
        if "→" not in line:
            continue
        en, cn = line.split("→", 1)
        en, cn = en.strip(), clean_cn(cn)
        if not en or not cn:
            continue
        if cn in ("忽略", "空字符串"):
            continue
        d[norm(en)] = cn
    return d

def main():
    trans = parse_translations()
    s = open(DATA, encoding="utf-8").read()
    i = s.index("{"); j = s.rindex("}")
    book = json.loads(s[i:j + 1])

    r_hit = l_hit = 0
    for p in book["pages"]:
        for r in p.get("regions", []):
            k = norm(r.get("text", ""))
            if k in trans:
                r["cn"] = trans[k]; r_hit += 1
        for ln in p.get("lines", []):
            k = norm(ln.get("t", ""))
            if k in trans:
                ln["cn"] = trans[k]; l_hit += 1

    book["translations"] = trans   # 嵌进站点, 供编辑器画框时自动联想中文

    with open(DATA, "w", encoding="utf-8") as f:
        f.write("const BOOK = ")
        json.dump(book, f, ensure_ascii=False, indent=1)
        f.write(";\n")

    print(f"翻译词条: {len(trans)} | 命中区域: {r_hit} | 命中行: {l_hit}")
    print(f"已写回: {DATA}")

if __name__ == "__main__":
    main()
