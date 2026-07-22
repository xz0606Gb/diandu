---
name: diandu-ocr
description: 把英语课本某一单元扫描版 PDF 做成可点读 + 带中文翻译的网页阅读器。当用户要为某个单元（如 unit2~unit6）生成点读书、或说"生成下一个单元 / 做点读课本 / 生成 unitN"时使用。
---

# 点读课本生成器 (diandu-ocr)

把某单元扫描版英语 PDF 做成自包含网页点读器：渲染页面 → OCR 行级识别 → edge-tts 英文朗读
→ 用户手动画点读区（热区）→ 中文翻译回填。每个脚本都接受「标识」参数，默认 `1`（数字按 `unitN` 处理，非数字直接用，如 `contents`/`tips`）。

## 前置
- 项目根目录（即本 skill 所在的项目目录），含 `build_reader.py` / `make_audio.py` / `fill_translations.py` / `merge_reader.py`
  与增强版 `index.html` / `app.js`（已带：手动画框编辑模式、语速滑块、显示文字/中文开关、封面单词学习入口），
  以及 `words_reader/`（单词学习模块源码：点读/听写/闪卡三模式，含 `index.html`/`app.js`/`style.css`/`parse.js`/`generate_audio.py`）。
  `words_table.MD`（示例词表，在项目根）由用户自行编辑后，运行 `node words_reader/parse.js && python words_reader/generate_audio.py`
  生成 `words_reader/data.js` 和 `words_reader/audio/*.mp3`（换课本/词表时无需动源码，重跑即可）。
- 依赖已装：pymupdf、rapidocr_onnxruntime、edge_tts（生成音频需联网）。
- 脚本用法：`python <脚本> 2` 处理 `unit2.pdf` → `unit2_reader/`；也接受任意标识，
  如 `python build_reader.py contents` → `contents.pdf` → `contents_reader/`；
  对应翻译文件命名为 `contentstranslator.md` / `tipstranslator.md`（即 `{标识}translator.md`）。
  不带参数默认单元 `1`。

## 流程（按单元号 N 执行）

### 第 1 步：基础生成（Claude 执行）
确认单元号 N 与 PDF 路径（默认项目根 `unit{N}.pdf`）。运行：
```
python build_reader.py N
```
产出 `unit{N}_reader/`：`pages/*.png` + `audio/*.mp3`（自动分句朗读）+ `data.js`
+ 复制进来的增强版 `index.html`/`app.js`。
- 耗时长（全页 OCR + 逐句 TTS），需联网；建议后台跑并等完成。
- 换嗓音：`VOICE=en-GB-RyanNeural python build_reader.py N`。

### 第 2 步：用户手动画热区（用户执行）
浏览器打开 `unit{N}_reader/index.html` → 点「✎ 编辑点读区」→ 拖拽画框定义点读区
（框内英文自动填入）→ 点「⬇ 导出」把 `regions.json` 存进 `unit{N}_reader/` 目录。

### 第 3 步：用户写翻译文件（用户执行）
新建 `unit{N}translator.md`，每行一条：
```
英文原文 → 中文翻译
```
- 译注用全角（）包裹，如 `Albert loves football. → 阿尔伯特热爱足球。（原文无空格）`，
  `fill_translations.py` 会自动剥离（）内译注。
- 空行 / 无 `→` 的行忽略。OCR 常把词连写（`SchoolGlubs`/`Footballclub`/`sports.club`），
  脚本用归一化英文（去空格/标点/小写）匹配，无需手动对齐。

### 第 4 步：烘焙音频 + 回填中文（Claude 执行）
用户把 `regions.json` 放到 `unit{N}_reader/` 并写好 `unit{N}translator.md` 后，运行：
```
python make_audio.py N
python fill_translations.py N
```
- `make_audio.py`：按 regions.json 逐热区生成 `audio/region_*.mp3`，写回 `data.js` 的
  `page.regions`（含 `x/y/w/h/text/audio/cn`；cn 会从词典补）。
- `fill_translations.py`：按归一化英文匹配 translator.md，给所有 `page.regions[].cn`
  和 `line.cn` 填中文，并把整本词典嵌成 `BOOK.translations`（供编辑器画新框自动联想中文）。

### 第 5 步：用户验收
刷新 `unit{N}_reader/index.html`，勾选「显示中文」查看；「整页连读」也会显示中文。
若某点读区没中文，多为：① 空框（框内无文字）；② OCR 英文与翻译文件写法差太多。
把没翻的英文原文告诉我，我加进 translator.md 再跑一次 `fill_translations.py N`。

## 汇总成书（合并全部单元 + 单词学习）

所有单元经第 1–5 步做完后，运行：
```bash
python merge_reader.py
```
产出**自包含**的 `book_reader/`：拼接 `contents`+`unit1~6`+`tips` 全部页面、复制 `index.html`/`app.js`、`data.js`、`pages/`/`audio/`、封面图，并**把整个 `words_reader/` 复制进 `book_reader/words_reader/`**。

- 封面「📚 单词学习」入口与工具条「📚 单词」按钮，通过 iframe 加载 `words_reader/index.html`（**相对子目录路径**，与 `book_reader/index.html` 同目录），两套脚本 iframe 隔离、零冲突。
- **部署铁律**：把 `book_reader/` **整个目录**上传，内含的 `words_reader/` 子文件夹必须一起带上。线上 `https://站点/words_reader/index.html` 必须能直接打开。
- **绝不能用 `../words_reader/`**：一旦把 `book_reader` 作为网站根目录部署，`../` 会逸出 web 根 → 404 NOT_FOUND。子目录相对路径在 `file://`、本地 `http://`、任意托管下行为一致。
- `openWords()` 只直接设 `iframe.src = "words_reader/index.html"`，**不要做 `contentDocument.title` 之类的加载检测**：`file://` 下跨源读取会拿到 `null`/报错，曾被误判成"未找到"，还曾因 `srcdoc` 兜底没清 `onload` 引发无限闪烁。简单直接即可。
- **words_reader 的 data.js 和 audio/ 不在包内**——让用户编辑 `words_table.MD` 后自己跑：
  ```bash
  node words_reader/parse.js
  python words_reader/generate_audio.py
  ```
  （换课本/词表时同理，无需动源码）

## 关键约定
- 点读区数据在 `page.regions`；未手绘的页回退到自动分句 `lines`/`utts`（每行也可点读+显示中文）。
- 中文存在每区域/每行的 `cn` 字段，与 `text` 分开（`text` 仍用于英文朗读）。
- 显示优先级：区域自带 cn → 浏览器 localStorage 编辑 cn（按坐标匹配）→ `BOOK.translations` 查表。
- 编辑器画新框时 `cnFor()` 自动按文字联想中文，无需手填。
- 背景与踩坑见项目记忆 `diandu-pipeline.md`；单词学习模块部署与 `file://` 下的坑见 `book_reader-words-404.md`。
