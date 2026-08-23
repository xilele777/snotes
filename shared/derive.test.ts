import { describe, expect, it } from 'vitest'
import { derive, extractSummary, extractThumbnail, extractTitle } from './derive'

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
  it('折叠换行与多余空白为单空格', () => {
    expect(extractSummary('标题\n\n第一段\n第二段')).toBe('标题 第一段 第二段')
  })

  it('剥掉图片语法但保留链接文字', () => {
    expect(extractSummary('看图 ![alt](/api/images/k1) 和 [文档](https://x.com)')).toBe(
      '看图 和 文档'
    )
  })

  it('剥掉行内强调标记', () => {
    expect(extractSummary('**粗体** _斜体_ `代码`')).toBe('粗体 斜体 代码')
  })

  it('剥掉行首的标题与引用标记', () => {
    expect(extractSummary('# 标题\n> 引用\n正文')).toBe('标题 引用 正文')
  })

  it('行中间的 # 与 > 按普通字符保留——它们本来就不是 Markdown 语法', () => {
    expect(extractSummary('话题 #标签 与 a > b')).toBe('话题 #标签 与 a > b')
  })

  it('截断到 120 字符', () => {
    expect(extractSummary('文'.repeat(200))).toHaveLength(120)
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
  it('一次返回三个派生字段', () => {
    expect(derive('# 标题\n正文 ![](/api/images/x.png)')).toEqual({
      title: '标题',
      summary: '标题 正文',
      thumbnail: 'x.png',
    })
  })
})
