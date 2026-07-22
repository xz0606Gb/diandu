#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把手绘点读区(regions.json)生成音频并写回 data.js。

用法:
    python make_audio.py                # 默认 unit1: 读 unit1_reader/regions.json
    python make_audio.py 2              # 处理 unit2_reader
    python make_audio.py contents       # 处理 contents_reader
    python make_audio.py 2 path/to/regions.json   # 指定 regions 路径
    VOICE=en-GB-RyanNeural python make_audio.py 2

依赖: edge-tts  (pip install edge-tts)
"""
import os, re, sys, json, asyncio
import edge_tts

HERE = os.path.dirname(os.path.abspath(__file__))
UNIT = sys.argv[1] if len(sys.argv) > 1 else "1"
ID = f"unit{UNIT}" if UNIT.isdigit() else UNIT
OUT_DIR = os.path.join(HERE, f"{ID}_reader")
DATA = os.path.join(OUT_DIR, "data.js")
AUDIO_DIR = os.path.join(OUT_DIR, "audio")

VOICE = os.environ.get("VOICE", "en-US-AriaNeural")
CN_VOICE = os.environ.get("CN_VOICE", "zh-CN-XiaoxiaoNeural")
CONCURRENCY = 8

CJK_RE = re.compile(r"[　-〿㐀-䶿一-鿿豈-﫿＀-￯]+")

def choose_voice(full):
    cjk = CJK_RE.findall(full)
    lat = re.findall(r"[A-Za-z]", full)
    if not lat and cjk:
        return CN_VOICE, full            # 纯中文
    if not cjk:
        return VOICE, full               # 纯英文/数字
    tts = re.sub(r"\s+", " ", CJK_RE.sub(" ", full)).strip()  # 中英混排: 去中文
    return VOICE, tts

def load_book():
    with open(DATA, encoding="utf-8") as f:
        s = f.read()
    i = s.index("{")
    j = s.rindex("}")
    return json.loads(s[i:j + 1])

def tr_cn(text):
    k = re.sub(r"[^a-z0-9]", "", (text or "").lower())
    return TR.get(k)

TR = {}   # 翻译词典, 在 main 里从 book 载入

def text_from_lines(lines, r):
    inside = [l for l in lines
              if (l["x"] + l["w"] / 2) >= r["x"]
              and (l["x"] + l["w"] / 2) <= r["x"] + r["w"]
              and (l["y"] + l["h"] / 2) >= r["y"]
              and (l["y"] + l["h"] / 2) <= r["y"] + r["h"]]
    inside.sort(key=lambda l: (l["y"], l["x"]))
    return " ".join(l["t"] for l in inside)

async def gen_one(text, path, sem):
    async with sem:
        voice, tts = choose_voice(text)
        if not tts.strip():
            return False
        for attempt in range(3):
            try:
                await edge_tts.Communicate(tts, voice).save(path)
                return True
            except Exception as e:
                if attempt == 2:
                    print(f"  [warn] 音频生成失败 {os.path.basename(path)}: {e}")
                await asyncio.sleep(1)
        return False

async def main():
    reg_path = sys.argv[2] if len(sys.argv) > 2 else os.path.join(OUT_DIR, "regions.json")
    if not os.path.exists(reg_path):
        print("找不到 regions.json，请先在浏览器编辑模式里导出。")
        return
    with open(reg_path, encoding="utf-8") as f:
        doc = json.load(f)
    pages_regs = doc.get("pages", [])
    book = load_book()
    TR.update(book.get("translations", {}))

    sem = asyncio.Semaphore(CONCURRENCY)
    tasks = []          # (page_idx, reg_idx, text, mp3_path)
    for i, page in enumerate(book["pages"]):
        regs = pages_regs[i] if i < len(pages_regs) else []
        for j, r in enumerate(regs):
            text = (r.get("text") or "").strip() or text_from_lines(page.get("lines", []), r)
            mp3 = os.path.join(AUDIO_DIR, f"region_{i+1:03d}_{j:03d}.mp3")
            tasks.append((i, j, text, mp3))

    print(f"== 生成 {len(tasks)} 个区域音频 ==")
    results = await asyncio.gather(*[gen_one(t, p, sem) for (_, _, t, p) in tasks])

    # 写回 book
    for (i, j, text, mp3), ok in zip(tasks, results):
        rel = os.path.relpath(mp3, OUT_DIR).replace("\\", "/")
        r = pages_regs[i][j]
        r["text"] = text
        if not r.get("cn"):
            r["cn"] = tr_cn(text)          # 从词典补中文
        r["audio"] = rel if ok else None
        book["pages"][i]["regions"] = pages_regs[i]

    with open(DATA, "w", encoding="utf-8") as f:
        f.write("const BOOK = ")
        json.dump(book, f, ensure_ascii=False, indent=1)
        f.write(";\n")

    ok_n = sum(1 for o in results if o)
    print(f"完成! 成功 {ok_n}/{len(tasks)} 个音频，已写回 data.js")
    print(f"刷新: file:///{OUT_DIR}/index.html")

if __name__ == "__main__":
    asyncio.run(main())
