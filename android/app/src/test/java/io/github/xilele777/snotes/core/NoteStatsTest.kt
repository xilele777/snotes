package io.github.xilele777.snotes.core

import io.github.xilele777.snotes.core.database.GroupEntity
import io.github.xilele777.snotes.core.database.NoteEntity
import io.github.xilele777.snotes.core.model.buildActivity
import io.github.xilele777.snotes.core.model.computeNoteStats
import io.github.xilele777.snotes.core.model.countWords
import io.github.xilele777.snotes.core.model.extractSearchExcerpt
import io.github.xilele777.snotes.core.model.matchesAllTerms
import io.github.xilele777.snotes.core.model.searchHitRanges
import io.github.xilele777.snotes.core.model.splitSearchTerms
import io.github.xilele777.snotes.core.model.sqlSearchTerms
import java.time.LocalDate
import java.time.ZoneOffset
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NoteStatsTest {
    @Test
    fun countWordsMatchesWebRules() {
        assertEquals(0, countWords(""))
        assertEquals(0, countWords("   \n\t  "))
        assertEquals(7, countWords("你好，世界! hello world 2026"))
        assertEquals(7, countWords("今天写了 123 个字"))
    }

    @Test
    fun computeStatsCalculatesWordsStreaksGroupsAndHeatmap() {
        val zone = ZoneOffset.UTC
        val today = LocalDate.of(2026, 11, 20)
        fun ts(day: LocalDate) = day.atStartOfDay(zone).toInstant().toEpochMilli()

        val notes = listOf(
            NoteEntity("n1", groupId = "g1", title = "第一篇", star = 1, top = 1, createTime = ts(today.minusDays(2)), updateTime = ts(today), dirty = "none"),
            NoteEntity("n2", groupId = "g1", title = "第二篇", createTime = ts(today.minusDays(1)), updateTime = ts(today.minusDays(1)), dirty = "none"),
            NoteEntity("n3", groupId = null, title = "回收站", invalid = 1, createTime = ts(today.minusDays(5)), updateTime = ts(today.minusDays(5)), dirty = "none"),
        )
        val bodies = mapOf(
            "n1" to "今天记录一些想法 hello world",
            "n2" to "继续写日记",
            "n3" to "回收站内容不计入总字数",
        )
        val groups = listOf(GroupEntity("g1", "随笔", color = "#4668E8"))
        val opens = mapOf("n1" to 4L, "n2" to 1L, "n3" to 9L)

        val stats = computeNoteStats(notes, bodies, groups, opens, bookCount = 2, today = today, zone = zone)
        assertEquals(2, stats.active)
        assertEquals(1, stats.starred)
        assertEquals(1, stats.topped)
        assertEquals(1, stats.trashed)
        assertEquals(2, stats.books)
        assertEquals(15, stats.totalWords)
        assertEquals(8, stats.avgWords)
        assertEquals(5L, stats.totalOpens)
        assertEquals(2, stats.streakCurrent)
        assertEquals(2, stats.streakLongest)
        assertEquals(53, stats.heatmapWeeks.size)
        assertEquals("随笔", stats.byGroup.first().name)
        assertEquals(2, stats.byGroup.first().count)
        assertEquals("n1", stats.mostOpened.first().id)

        val activity7 = buildActivity(stats.activeNotes, 7, today = today, zone = zone)
        assertEquals(7, activity7.size)
        assertEquals(2, activity7.sumOf { it.created })
        assertEquals(2, activity7.sumOf { it.updated })
    }

    @Test
    fun searchHelpersSupportMultiKeywordFullTextAndExcerpts() {
        assertEquals(listOf("会议", "纪要"), splitSearchTerms("  会议　纪要  "))
        assertEquals(listOf("alpha", "beta", "", ""), sqlSearchTerms("alpha beta").toList())
        assertTrue(matchesAllTerms("第一季度产品复盘与下周排期", "产品  排期"))
        assertFalse(matchesAllTerms("第一季度产品复盘", "产品  排期"))

        val longBody = "# 周五研发周会\n\n" +
            "前半段是常规进度同步，介绍了前端组件重构以及样式对齐情况，整体已经接近收尾阶段，细节都已确认完毕。\n\n" +
            "后半段重点讨论了离线检索架构升级方案，明确全文检索必须同时覆盖标题、摘要和长正文内容。"
        val excerpt = extractSearchExcerpt(longBody, "离线检索 架构")
        assertNotNull(excerpt)
        assertTrue(excerpt!!.contains("离线检索架构"))

        val ranges = searchHitRanges("全文检索与离线检索架构", "检索 架构")
        assertEquals(listOf(2 to 4, 7 to 11), ranges)
    }
}
