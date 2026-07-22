# -*- coding: utf-8 -*-
"""用 edge-tts 为每个单词生成本地 mp3 语音。
输出: audio/{index}.mp3  (index 与 data.js 中 WORDS 的顺序一致)
可重复运行：已存在的文件会跳过。
"""
import asyncio
import os
import re

import edge_tts

SRC = os.path.join(os.path.dirname(__file__), "..", "words_table.MD")
OUT_DIR = os.path.join(os.path.dirname(__file__), "audio")
VOICE = "en-US-AriaNeural"   # 清晰的美式英语神经语音
RATE = "+0%"                 # 正常语速；网页端以 playbackRate 控制 0.75x

os.makedirs(OUT_DIR, exist_ok=True)


def parse_words(path):
    words = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            s = line.strip()
            if not s.startswith("|"):
                continue
            if s.startswith("| ---") or re.match(r"^\|\s*英文单词", s):
                continue
            cells = [c.strip() for c in s.split("|")[1:-1]]
            if len(cells) < 5 or not cells[0]:
                continue
            words.append(cells[0])
    return words


async def main():
    words = parse_words(SRC)
    print(f"共 {len(words)} 个单词，开始生成语音到 {OUT_DIR} ...")
    sem = asyncio.Semaphore(8)  # 适度并发

    async def gen(i, text):
        out = os.path.join(OUT_DIR, f"{i}.mp3")
        if os.path.exists(out) and os.path.getsize(out) > 0:
            return
        async with sem:
            try:
                comm = edge_tts.Communicate(text, VOICE, rate=RATE)
                await comm.save(out)
            except Exception as e:
                print(f"  [失败] {i}: {text} -> {e}")

    tasks = [gen(i, w) for i, w in enumerate(words)]
    for done in asyncio.as_completed(tasks):
        await done

    ok = sum(1 for i in range(len(words))
             if os.path.exists(os.path.join(OUT_DIR, f"{i}.mp3")))
    print(f"完成：{ok}/{len(words)} 个 mp3 已生成。")


if __name__ == "__main__":
    asyncio.run(main())
