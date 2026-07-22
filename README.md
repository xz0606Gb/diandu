# diandu
这是一个基于英语电子版教材生成点读课本的skill。

原本想从网上找类似的skill，但是没有找到，或者不合心意，决定自己创建一个skill，分析给需要的人。

用Claude code创建（总消耗55Mtoken，用的是hy3），原本的skill.md在这个目录下`.claude/skills/diandu-ocr/SKILL.md`。现在把skill移动到根目录了，所有agent都可以用，我用work Buddy测试安装使用没问题。

详细使用方式在目录内的“使用说明.md”文件。

简要说明下：
	安装依赖：`pymupdf`/`rapidocr_onnxruntime`/ `edge_tts` / `numpy`
	
操作注意：

**重要**一定要把各单元分开生成，因为每个单元都要手动画热区，即使是数字版的pdf也无法自动生成想要的热区，所以一定要手动画。不过数字版的热区比扫描版的文字识别率高很多。无论是数字版还是扫描版，热区画的时候，都会自动带出来识别的英文，只不过扫描版识别成功率只有95%左右，数字版可以达到99%正确。创建封面目录也需要分开各单元。

skill安装好后，把{ID}_reader.pdf都给它，和它说 “生成{ID}_reader.pdf”，它开始执行，并生成{ID}_reader文件夹，好了以后，会提示你让你生成regions.json，这个时候你要打开{ID}_reader文件夹内的index.html画热区。

画完热区导出regions.json，这个文件一定要放在系统生成的{ID}_reader/文件夹内。

**重要**然后用regions.json把需要翻译的英文提取出来。这个就用免费的网页版deepseek就行，非常好用。regions.json发给deepseek，提示词用：“把这个文件内所有"text": 后面的英文提取出来，并附上翻译的中文，中间符号用 →”。复制内容，创建一个{ID}translator.md的文件放到book_reader\文件夹内。

准备好这两个文件，放到对的地方，就告诉它，“继续”。它就会执行完。

然后准备下一个单元。

所有单元生成完后，单词可以最后生成，然后再整合到book_reader/下。（如果是扫描的pdf可以用下markitdown）

本地可以愉快的使用了，如果要托管可以参考用托管的（我的腾讯的）+域名（也是腾讯的1元1年）

目录详解：

1. index.html没有内容的首页（可看下样式）

2. 封面.jpg，这个是最终合成的时候需要的封面图，可自行替换。

3. words_table.MD 和 words_reader文件夹，这个要重点说明一下，因为当天api受限了，所以用work Buddy生成的，还挺好用，所以直接发给claude code，一起整合了。最开始是分开的文件夹，但是上传的托管只能一个文件夹，所以又把words_reader文件夹整合到book_reader/下，具体可以看“使用说明.md”。
	
