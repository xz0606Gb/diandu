#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把扫描版英语 PDF 做成点读课本。
流程: 渲染每页 PNG -> RapidOCR 行级识别(文字+坐标) -> 按"句子/语段"分组
      -> edge-tts 逐句生成音频 -> 输出自包含站点

分组规则: 连续多行若当前行不以句末标点(.!?)结尾, 则并入同一朗读单元,
         解决"一句话折成多行"点读不连贯的问题。纯符号行(如 ★)会被跳过。
用法:
    python build_reader.py            # 默认处理 unit1.pdf -> unit1_reader/
    python build_reader.py 2          # 处理 unit2.pdf -> unit2_reader/
    python build_reader.py contents   # 处理 contents.pdf -> contents_reader/ (任意标识)
    VOICE=en-GB-RyanNeural python build_reader.py 2   # 换英音/男声
"""
import os, re, sys
import json, asyncio
import numpy as np
import fitz  # pymupdf
from rapidocr_onnxruntime import RapidOCR

UNIT       = sys.argv[1] if len(sys.argv) > 1 else "1"
HERE       = os.path.dirname(os.path.abspath(__file__))
ID         = f"unit{UNIT}" if UNIT.isdigit() else UNIT
PDF_PATH   = os.path.join(HERE, f"{ID}.pdf")
OUT_DIR    = os.path.join(HERE, f"{ID}_reader")
PAGES_DIR  = os.path.join(OUT_DIR, "pages")
AUDIO_DIR  = os.path.join(OUT_DIR, "audio")
DPI        = int(os.environ.get("DPI", "150"))
VOICE      = os.environ.get("VOICE", "en-US-AriaNeural")      # 英文嗓音
CN_VOICE   = os.environ.get("CN_VOICE", "zh-CN-XiaoxiaoNeural")  # 中文行兜底
CONCURRENCY = 8

CJK_RE = re.compile(r"[㐀-鿿]")
HAS_TEXT_RE = re.compile(r"[0-9A-Za-z㐀-鿿]")
ABBREVS = {"mr", "mrs", "ms", "dr", "prof", "st", "mt", "vs", "etc",
           "jr", "sr", "no", "fig", "eq", "co", "inc", "ltd"}
INITIALS_RE = re.compile(r"^([A-Z]\.)+$")   # 匹配 U.S. / E.G. 之类

os.makedirs(PAGES_DIR, exist_ok=True)
os.makedirs(AUDIO_DIR, exist_ok=True)


def is_sentence_end(text):
    """当前行是否结束一个句子(从而与下一行断开)。"""
    t = text.rstrip()
    if t.endswith(("!", "?", "。", "！", "？")):
        return True
    if t.endswith((".", "．")):
        last = t.rsplit(None, 1)[-1].rstrip(".).。!?")
        low = last.lower()
        if low in ABBREVS or INITIALS_RE.match(last):
            return False
        return True
    return False


def render_pages(doc):
    meta = []
    for i, page in enumerate(doc):
        pix = page.get_pixmap(dpi=DPI)
        png = os.path.join(PAGES_DIR, f"page_{i+1:03d}.png")
        pix.save(png)
        meta.append({"png": png, "w": pix.width, "h": pix.height})
        print(f"  rendered page {i+1}/{doc.page_count} -> {pix.width}x{pix.height}")
    return meta


def ocr_lines(img, w, h):
    engine = RapidOCR()
    res, _ = engine(img)
    lines = []
    for det in res:
        poly, text = det[0], det[1].strip()
        if not text or not HAS_TEXT_RE.search(text):   # 跳过纯符号/空行(如 ★)
            continue
        xs = [p[0] for p in poly]; ys = [p[1] for p in poly]
        lines.append({
            "t": text,
            "x": round(min(xs) / w, 5), "y": round(min(ys) / h, 5),
            "w": round((max(xs) - min(xs)) / w, 5),
            "h": round((max(ys) - min(ys)) / h, 5),
        })
    lines.sort(key=lambda b: (round(b["y"] * h / 20), b["x"]))
    return lines


def group_utterances(lines):
    """把连续行合并成语段; 返回 list[list[line]]。"""
    utts, grp = [], []
    for ln in lines:
        grp.append(ln)
        if is_sentence_end(ln["t"]):
            utts.append(grp); grp = []
    if grp:
        utts.append(grp)
    return utts


async def gen_audio(utts, page_idx):
    import edge_tts
    sem = asyncio.Semaphore(CONCURRENCY)

    async def one(grp, k):
        full = " ".join(l["t"] for l in grp)
        mp3 = os.path.join(AUDIO_DIR, f"page_{page_idx+1:03d}_utt_{k:03d}.mp3")
        path = f"audio/page_{page_idx+1:03d}_utt_{k:03d}.mp3"
        cjk = CJK_RE.findall(full)
        lat = re.findall(r"[A-Za-z]", full)
        if len(cjk) > len(lat):
            voice, tts = CN_VOICE, full          # 纯中文行 -> 中文嗓音
        else:
            voice = VOICE
            tts = re.sub(r"\s+", " ", CJK_RE.sub(" ", full)).strip()  # 去中文释义
        rec = {"t": tts, "a": path}
        if not tts:
            rec["a"] = None
            return rec
        try:
            async with sem:
                await edge_tts.Communicate(tts, voice).save(mp3)
        except Exception as e:
            print(f"  [warn] audio fail p{page_idx+1} utt{k}: {e}")
            rec["a"] = None
        return rec

    return await asyncio.gather(*[one(grp, k) for k, grp in enumerate(utts)])


def main():
    print("== 1/4 渲染页面 ==")
    doc = fitz.open(PDF_PATH)
    meta = render_pages(doc)

    print("== 2/4 OCR + 分句 ==")
    book = {"voice": VOICE, "cnVoice": CN_VOICE, "dpi": DPI, "pages": []}
    # 先清掉旧音频, 避免残留
    for f in os.listdir(AUDIO_DIR):
        try: os.remove(os.path.join(AUDIO_DIR, f))
        except OSError: pass

    for i, m in enumerate(meta):
        pix = doc[i].get_pixmap(dpi=DPI)
        img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
        lines = ocr_lines(img, m["w"], m["h"])
        utts = group_utterances(lines)
        recs = asyncio.run(gen_audio(utts, i))
        page = {"img": f"pages/page_{i+1:03d}.png", "w": m["w"], "h": m["h"],
                "lines": [], "utts": recs}
        for k, grp in enumerate(utts):
            for ln in grp:
                ld = dict(ln); ld["u"] = k
                page["lines"].append(ld)
        book["pages"].append(page)
        print(f"  page {i+1}: {len(lines)} lines -> {len(utts)} utterances")

    print("== 3/4 写入站点 ==")
    with open(os.path.join(OUT_DIR, "data.js"), "w", encoding="utf-8") as f:
        f.write("const BOOK = ")
        json.dump(book, f, ensure_ascii=False, indent=1)
        f.write(";\n")
    print("  wrote data.js")

    import shutil
    here = os.path.dirname(os.path.abspath(__file__))
    for fn in ("index.html", "app.js"):
        src = os.path.join(here, fn)
        if os.path.exists(src):
            shutil.copy(src, os.path.join(OUT_DIR, fn))
            print(f"  copied {fn}")

    tot_lines = sum(len(p["lines"]) for p in book["pages"])
    tot_utts = sum(len(p["utts"]) for p in book["pages"])
    print(f"\n完成! 共 {doc.page_count} 页, {tot_lines} 视觉行, {tot_utts} 朗读句")
    print(f"打开: file:///{OUT_DIR}/index.html")
    doc.close()


if __name__ == "__main__":
    main()
