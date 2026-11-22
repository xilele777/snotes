package io.github.xilele777.snotes.core.model

import io.github.xilele777.snotes.core.database.GroupEntity
import io.github.xilele777.snotes.core.database.NoteEntity
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.time.temporal.TemporalAdjusters

private val wordTokenRegex = Regex("[\\u4e00-\\u9fff\\u3400-\\u4dbf]|[\\u3040-\\u30ff\\uac00-\\ud7af]|[A-Za-z0-9]+")
private val ymdFormatter = DateTimeFormatter.ISO_LOCAL_DATE

/** Mirror Web's shared/derive.ts countWords: CJK per character, Latin/digits per word. */
fun countWords(markdown: String): Int {
    if (markdown.isBlank()) return 0
    return wordTokenRegex.findAll(markdown).count()
}

data class ActivityBucket(
    val start: LocalDate,
    val end: LocalDate,
    val created: Int,
    val updated: Int,
)

data class HeatCell(
    val date: LocalDate,
    val count: Int,
)

data class HeatWeek(
    val weekStart: LocalDate,
    val days: List<HeatCell>,
)

data class GroupStat(
    val groupId: String?,
    val name: String,
    val color: String?,
    val count: Int,
)

data class LengthBucket(
    val label: String,
    val count: Int,
)

data class OpenedNoteStat(
    val id: String,
    val title: String,
    val opens: Long,
)

data class NoteStatsSnapshot(
    val active: Int,
    val starred: Int,
    val topped: Int,
    val trashed: Int,
    val books: Int,
    val totalWords: Int,
    val avgWords: Int,
    val totalOpens: Long,
    val streakCurrent: Int,
    val streakLongest: Int,
    val heatmapWeeks: List<HeatWeek>,
    val heatMax: Int,
    val lengthBuckets: List<LengthBucket>,
    val byGroup: List<GroupStat>,
    val mostOpened: List<OpenedNoteStat>,
    val activeNotes: List<NoteEntity>,
)

fun computeNoteStats(
    allNotes: List<NoteEntity>,
    bodies: Map<String, String>,
    groups: List<GroupEntity>,
    opensByNote: Map<String, Long>,
    bookCount: Int,
    today: LocalDate = LocalDate.now(),
    zone: ZoneId = ZoneId.systemDefault(),
): NoteStatsSnapshot {
    val activeNotes = allNotes.filter { it.invalid == 0 }
    val trashed = allNotes.count { it.invalid == 1 }
    val starred = activeNotes.count { it.star == 1 }
    val topped = activeNotes.count { it.top == 1 }

    var totalWords = 0
    val lengthCounts = IntArray(4)
    val updatedDayCounts = HashMap<LocalDate, Int>()
    val groupCounts = HashMap<String?, Int>()

    for (note in activeNotes) {
        val body = bodies[note.id].orEmpty()
        val words = countWords(body)
        totalWords += words
        val bucket = when {
            words < 100 -> 0
            words < 500 -> 1
            words < 2000 -> 2
            else -> 3
        }
        lengthCounts[bucket]++
        if (note.updateTime > 0L) {
            val day = Instant.ofEpochMilli(note.updateTime).atZone(zone).toLocalDate()
            updatedDayCounts[day] = (updatedDayCounts[day] ?: 0) + 1
        }
        groupCounts[note.groupId] = (groupCounts[note.groupId] ?: 0) + 1
    }

    // 53-week Monday-aligned heatmap matching Web's shared/stats.ts
    val weeks = 53
    val thisMonday = today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
    val firstMonday = thisMonday.minusWeeks((weeks - 1).toLong())
    var heatMax = 0
    val heatmapWeeks = (0 until weeks).map { w ->
        val weekStart = firstMonday.plusWeeks(w.toLong())
        val days = (0 until 7).map { d ->
            val day = weekStart.plusDays(d.toLong())
            val count = updatedDayCounts[day] ?: 0
            if (count > heatMax) heatMax = count
            HeatCell(day, count)
        }
        HeatWeek(weekStart, days)
    }

    // Current & longest streak matching Web's shared/stats.ts
    val sortedDays = updatedDayCounts.keys.sorted()
    var streakLongest = 0
    var run = 0
    if (sortedDays.isNotEmpty()) {
        var cursor = sortedDays.first()
        while (!cursor.isAfter(today)) {
            if (updatedDayCounts.containsKey(cursor)) {
                run++
                if (run > streakLongest) streakLongest = run
            } else {
                run = 0
            }
            cursor = cursor.plusDays(1)
        }
    }
    var streakCurrent = 0
    var currentCursor = if (updatedDayCounts.containsKey(today)) today else today.minusDays(1)
    while (updatedDayCounts.containsKey(currentCursor)) {
        streakCurrent++
        currentCursor = currentCursor.minusDays(1)
    }

    val groupById = groups.associateBy { it.id }
    val byGroup = groupCounts.entries
        .map { (gid, count) ->
            val info = gid?.let { groupById[it] }
            GroupStat(
                groupId = gid,
                name = info?.name ?: "未分组",
                color = info?.color,
                count = count,
            )
        }
        .sortedByDescending { it.count }

    val totalOpens = activeNotes.sumOf { opensByNote[it.id] ?: 0L }
    val mostOpened = activeNotes
        .mapNotNull { note ->
            val count = opensByNote[note.id] ?: 0L
            if (count > 0L) OpenedNoteStat(note.id, note.title.ifBlank { "无标题" }, count) else null
        }
        .sortedWith(compareByDescending<OpenedNoteStat> { it.opens }.thenBy { it.id })
        .take(5)

    return NoteStatsSnapshot(
        active = activeNotes.size,
        starred = starred,
        topped = topped,
        trashed = trashed,
        books = bookCount,
        totalWords = totalWords,
        avgWords = if (activeNotes.isEmpty()) 0 else kotlin.math.round(totalWords.toDouble() / activeNotes.size).toInt(),
        totalOpens = totalOpens,
        streakCurrent = streakCurrent,
        streakLongest = streakLongest,
        heatmapWeeks = heatmapWeeks,
        heatMax = heatMax.coerceAtLeast(1),
        lengthBuckets = listOf(
            LengthBucket("< 100 字", lengthCounts[0]),
            LengthBucket("100–499 字", lengthCounts[1]),
            LengthBucket("500–1999 字", lengthCounts[2]),
            LengthBucket("≥ 2000 字", lengthCounts[3]),
        ),
        byGroup = byGroup,
        mostOpened = mostOpened,
        activeNotes = activeNotes,
    )
}

/** Mirror Web's src/stats-activity.ts buildActivity: daily/weekly/monthly buckets. */
fun buildActivity(
    notes: List<NoteEntity>,
    periodDays: Int,
    today: LocalDate = LocalDate.now(),
    zone: ZoneId = ZoneId.systemDefault(),
): List<ActivityBucket> {
    val safeDays = periodDays.coerceAtLeast(1)
    val from = today.minusDays((safeDays - 1).toLong())
    val totalDays = ChronoUnit.DAYS.between(from, today).toInt() + 1
    val unit = when {
        totalDays > 93 -> "month"
        totalDays > 31 -> "week"
        else -> "day"
    }
    data class MutableBucket(val start: LocalDate, var end: LocalDate, var created: Int = 0, var updated: Int = 0)
    val buckets = ArrayList<MutableBucket>()
    val dayToBucket = HashMap<LocalDate, MutableBucket>()
    var cursor = from
    var index = 0
    while (!cursor.isAfter(today)) {
        val last = buckets.lastOrNull()
        val startNew = last == null ||
            unit == "day" ||
            (unit == "week" && index % 7 == 0) ||
            (unit == "month" && (cursor.year != last.start.year || cursor.monthValue != last.start.monthValue))
        val bucket = if (startNew) MutableBucket(cursor, cursor).also { buckets.add(it) } else last!!
        bucket.end = cursor
        dayToBucket[cursor] = bucket
        cursor = cursor.plusDays(1)
        index++
    }
    for (note in notes) {
        if (note.invalid == 2) continue
        if (note.createTime > 0L) {
            val d = Instant.ofEpochMilli(note.createTime).atZone(zone).toLocalDate()
            dayToBucket[d]?.let { it.created++ }
        }
        if (note.updateTime > 0L) {
            val d = Instant.ofEpochMilli(note.updateTime).atZone(zone).toLocalDate()
            dayToBucket[d]?.let { it.updated++ }
        }
    }
    return buckets.map { ActivityBucket(it.start, it.end, it.created, it.updated) }
}

fun formatYmd(date: LocalDate): String = ymdFormatter.format(date)
