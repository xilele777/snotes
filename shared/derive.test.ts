import { describe, expect, it } from 'vitest'
import { countWords, derive, extractSummary, extractThumbnail, extractTitle } from './derive'

describe('countWords', () => {
  it('空正文返回 0', () => {
    expect(countWords('')).toEqual({ words: 0, lines: 0, chars: 0 })
  })

  it('中文按字计数', () => {
    expect(countWords('今天天气不错').words).toBe(6)
  })

  it('英文按词计数，标点与空白不计', () => {
    expect(countWords('hello world, foo bar!').words).toBe(4)
  })

  it('中英混排各自按口径计', () => {
    expect(countWords('今天 hello 写了 200 字').words).toBe(7)
  })

  it('去除 Markdown 语法符号后计字', () => {
    const wc = countWords('# 标题\n\n- 列表项\n**加粗**')
    expect(wc.words).toBe(7)
    expect(wc.lines).toBe(3)
  })

  it('行数只算非空行', () => {
    expect(countWords('a\n\n\nb').lines).toBe(2)
  })

  it('可见字符总数不含 Markdown 标记', () => {
    expect(countWords('# hi').chars).toBe(2)
  })
})

describe('extractTitle', () => {
  it('取首个非空行', () => {
    expect(extractTitle('买菜清单\n牛奶\n鸡蛋')).toBe('买菜清单')
  })

  it('跳过开头的空行', () => {
    expect(extractTitle('\n\n  \n真正的标题\n正文')).toBe('真正的标题')
  })

  it('去掉 ATX 标题标记与其后空白', () => {
    expect(extractTitle('# 一级标题')).toBe('一级标题')
    expect(extractTitle('###   三级标题')).toBe('三级标题')
  })

  it('六个以上的井号不当作标题标记', () => {
    expect(extractTitle('####### 七个井号')).toBe('####### 七个井号')
  })

  it('剥掉行内强调标记', () => {
    expect(extractTitle('**加粗标题**')).toBe('加粗标题')
    expect(extractTitle('`代码标题`')).toBe('代码标题')
  })

  it('剥掉列表标记', () => {
    expect(extractTitle('- 待办一\n- 待办二')).toBe('待办一')
    expect(extractTitle('1. 第一步')).toBe('第一步')
  })

  it('链接只取可见文字', () => {
    expect(extractTitle('[WPS 便签](https://note.wps.cn/)')).toBe('WPS 便签')
  })

  // 以图片开头的笔记曾把整段 data URI 当成标题，是这次要修的主 bug
  it('跳过纯图片行，取后面第一行有文字的', () => {
    expect(extractTitle('![](/api/images/k.png)\n拍到的白板')).toBe('拍到的白板')
  })

  it('base64 内联图不进标题', () => {
    const dataUri = `data:image/png;base64,${'iVBORw0KGgo'.repeat(20)}`
    expect(extractTitle(`![](${dataUri})\n真正的标题`)).toBe('真正的标题')
  })

  it('图片与文字同行时只留文字', () => {
    expect(extractTitle('![](/api/images/k.png) 会议纪要')).toBe('会议纪要')
  })

  it('全文只有图片时返回空串，由界面落到「无标题」', () => {
    expect(extractTitle('![](/api/images/a.png)\n\n![alt](/api/images/b.png)')).toBe('')
  })

  it('截断到 64 字符', () => {
    const long = 'a'.repeat(100)
    expect(extractTitle(long)).toHaveLength(64)
  })

  it('空内容返回空串', () => {
    expect(extractTitle('')).toBe('')
    expect(extractTitle('   \n\n  ')).toBe('')
  })
})

describe('extractSummary', () => {
  // 摘要从标题的下一行起算，否则列表里每条笔记的第二行都在复读第一行
  it('跳过标题那一行，不重复标题', () => {
    expect(extractSummary('买菜清单\n牛奶\n鸡蛋')).toBe('牛奶 鸡蛋')
    expect(extractSummary('# 标题\n正文')).toBe('正文')
  })

  it('只有一行内容时摘要为空', () => {
    expect(extractSummary('只有一行标题没有正文')).toBe('')
    expect(extractSummary('# 只有标题\n\n  \n')).toBe('')
  })

  it('标题跳过的纯图片行，摘要也跟着跳——两者走同一份切分', () => {
    expect(extractTitle('![](/api/images/k.png)\n白板照片\n补充说明')).toBe('白板照片')
    expect(extractSummary('![](/api/images/k.png)\n白板照片\n补充说明')).toBe('补充说明')
  })

  it('折叠换行与多余空白为单空格', () => {
    expect(extractSummary('标题\n\n第一段\n第二段')).toBe('第一段 第二段')
  })

  it('剥掉图片语法但保留链接文字', () => {
    expect(extractSummary('标题\n看图 ![alt](/api/images/k1) 和 [文档](https://x.com)')).toBe(
      '看图 和 文档'
    )
  })

  it('剥掉行内强调标记', () => {
    expect(extractSummary('标题\n**粗体** _斜体_ `代码`')).toBe('粗体 斜体 代码')
  })

  it('剥掉行首的标题与引用标记', () => {
    expect(extractSummary('# 标题\n> 引用\n正文')).toBe('引用 正文')
  })

  it('剥掉行首的列表标记', () => {
    expect(extractSummary('购物清单\n- 牛奶\n- 鸡蛋\n1. 先买牛奶')).toBe('牛奶 鸡蛋 先买牛奶')
  })

  it('行中间的 # 与 > 按普通字符保留——它们本来就不是 Markdown 语法', () => {
    expect(extractSummary('标题\n话题 #标签 与 a > b')).toBe('话题 #标签 与 a > b')
  })

  it('截断到 120 字符', () => {
    expect(extractSummary(`标题\n${'文'.repeat(200)}`)).toHaveLength(120)
  })

  it('空内容返回空串', () => {
    expect(extractSummary('')).toBe('')
  })
})

describe('extractThumbnail', () => {
  it('取首个同源图片的 file_key', () => {
    expect(extractThumbnail('前言\n![](/api/images/abc-1.jpg)\n![](/api/images/def-2.jpg)')).toBe(
      'abc-1.jpg'
    )
  })

  it('带 alt 文本也能识别', () => {
    expect(extractThumbnail('![我的图](/api/images/k.png)')).toBe('k.png')
  })

  it('忽略 blob 占位图', () => {
    expect(extractThumbnail('![](blob:http://x/abc)')).toBeNull()
  })

  it('忽略外部域名图片', () => {
    expect(extractThumbnail('![](https://evil.com/a.png)')).toBeNull()
  })

  it('跳过外部图片取后面的同源图片', () => {
    expect(extractThumbnail('![](https://evil.com/a.png)\n![](/api/images/good.png)')).toBe(
      'good.png'
    )
  })

  it('无图片返回 null', () => {
    expect(extractThumbnail('纯文字')).toBeNull()
  })
})

describe('derive', () => {
  it('一次返回三个派生字段，摘要不含标题', () => {
    expect(derive('# 标题\n正文 ![](/api/images/x.png)')).toEqual({
      title: '标题',
      summary: '正文',
      thumbnail: 'x.png',
    })
  })
})
