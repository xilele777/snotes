package io.github.xilele777.snotes.core.model

const val MAX_NOTE_BYTES = 1024 * 1024
private const val TITLE_MAX = 64
private const val SUMMARY_MAX = 120
private const val IMAGE_PREFIX = "/api/images/"

// ECMAScript whitespace differs from JVM \s and Kotlin's default trim.
private const val JS_SPACE_CHARS = "\\t\\n\\u000b\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff"
private const val JS_SPACE = "[$JS_SPACE_CHARS]"
private val whitespace = Regex("$JS_SPACE+")
private val leadingHeading = Regex("^$JS_SPACE{0,3}#{1,6}$JS_SPACE+")
private val leadingQuote = Regex("^$JS_SPACE{0,3}>$JS_SPACE?")
private val leadingBullet = Regex("^$JS_SPACE{0,3}(?:[-*+]|\\d{1,9}[.)])$JS_SPACE+")
private val image = Regex("!\\[[^\\]]*\\]\\($JS_SPACE*(?:<$JS_SPACE*([^>]+?)$JS_SPACE*>|([^)$JS_SPACE_CHARS]+))[^)]*\\)")
private val link = Regex("\\[([^\\]]*)\\]\\([^)]*\\)")
private val emphasis = Regex("[*_`~]")
private val fence = Regex("^$JS_SPACE{0,3}(`{3,}|~{3,})")
private val indentedCode = Regex("^(?: {4,}|\\t)")
private val inlineCode = Regex("`+[^`]*`+")
private val legacyBr = Regex("^$JS_SPACE*(?:<br />|<br>|<br >|<br/>)$JS_SPACE*$")
private val autolinkOrTag = Regex("(<[a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\\u0000-\\u0020<>]*>|<[a-zA-Z0-9.!#\u0024%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?>)|<(?=[!/?a-zA-Z])")

private fun Char.isJsSpace(): Boolean = this in "\t\n\u000b\u000c\r \u00a0\u1680\u2028\u2029\u202f\u205f\u3000\ufeff" || this in '\u2000'..'\u200a'
private fun String.trimJs(): String = trim { it.isJsSpace() }

private fun stripLine(line: String): String = line
    .replaceFirst(leadingHeading, "")
    .replaceFirst(leadingQuote, "")
    .replaceFirst(leadingBullet, "")
    .replace(image, " ")
    .replace(link) { it.groupValues[1] }
    .replace(emphasis, "")
    .replace(whitespace, " ")
    .trimJs()

fun visibleCharacterCount(markdown: String): Int = markdown.split('\n').sumOf { stripLine(it).length }

/** Preserve the Web client's UTF-16 truncation and title/summary split. */
fun derive(markdown: String): DerivedFields {
    val lines = markdown.split('\n').map(::stripLine).filter(String::isNotEmpty)
    val thumbnail = image.findAll(markdown).map { match ->
        (match.groups[1]?.value ?: match.groups[2]?.value.orEmpty()).trimJs()
    }.firstOrNull { it.startsWith(IMAGE_PREFIX) }?.removePrefix(IMAGE_PREFIX)
    return DerivedFields(
        title = lines.firstOrNull().orEmpty().take(TITLE_MAX),
        summary = lines.drop(1).joinToString(" ").take(SUMMARY_MAX),
        thumbnail = thumbnail,
    )
}

/** TextEncoder replaces isolated UTF-16 surrogates with U+FFFD (three bytes). */
fun utf8ByteLength(text: String): Long {
    var bytes = 0L
    var index = 0
    while (index < text.length) {
        val char = text[index]
        bytes += when {
            char.code <= 0x7f -> 1
            char.code <= 0x7ff -> 2
            char.isHighSurrogate() && index + 1 < text.length && text[index + 1].isLowSurrogate() -> {
                index++
                4
            }
            else -> 3
        }
        index++
    }
    return bytes
}

fun noteFits(content: String): Boolean = content.length <= MAX_NOTE_BYTES && utf8ByteLength(content) <= MAX_NOTE_BYTES

private fun transformOutsideCode(markdown: String, transform: (String) -> String): String {
    var fenceChar: Char? = null
    return markdown.split('\n').joinToString("\n") { line ->
        val opening = fence.find(line)
        if (opening != null) {
            val char = opening.groupValues[1][0]
            if (fenceChar == null) fenceChar = char else if (fenceChar == char) fenceChar = null
            line
        } else if (fenceChar != null || indentedCode.containsMatchIn(line)) {
            line
        } else transform(line)
    }
}

/** Rendering compatibility only; never call this to rewrite stored Markdown on open. */
fun migrateLegacyBr(markdown: String): String = transformOutsideCode(markdown) { line ->
    if (legacyBr.matches(line)) "\u200b" else line
}

fun escapeRawHtml(markdown: String): String = transformOutsideCode(markdown) { line ->
    // Match shared/sanitize.ts: choose a sentinel absent from this exact line.
    var code = 0xe000
    while (line.contains(code.toChar())) {
        code++
        require(code <= 0xffff) { "No available inline-code sentinel" }
    }
    val mask = code.toChar().toString()
    val spans = mutableListOf<String>()
    val masked = line.replace(inlineCode) { match ->
        spans += match.value
        "$mask${spans.lastIndex}$mask"
    }
    escapeText(masked).split(mask).mapIndexed { index, part ->
        if (index % 2 == 1) spans[part.toInt()] else part
    }.joinToString("")
}

private fun escapeText(text: String): String = text.replace(autolinkOrTag) { match ->
    match.groups[1]?.value ?: "&lt;"
}

/**
 * Splits a user search query into distinct lowercased terms (matches Web `splitTerms` in `src/components/SearchBar.ts`).
 */
fun splitSearchTerms(query: String): List<String> =
    query.trimJs().lowercase().split(whitespace).filter(String::isNotEmpty).distinct()

/**
 * Packs a query into 4 SQLite parameter slots `[t1, t2, t3, t4]` so multi-word queries match across
 * title, summary, and full body text without dropping trailing words.
 */
fun sqlSearchTerms(query: String): Array<String> {
    val trimmed = query.trimJs().lowercase()
    if (trimmed.isEmpty()) return arrayOf("", "", "", "")
    val parts = trimmed.split(whitespace, limit = 4).filter(String::isNotEmpty)
    return Array(4) { idx -> parts.getOrElse(idx) { "" } }
}

fun matchesAllTerms(text: String, query: String): Boolean {
    val terms = splitSearchTerms(query)
    if (terms.isEmpty()) return true
    val lower = text.lowercase()
    return terms.all { term -> lower.contains(term) }
}

/**
 * Extracts a clean body excerpt centered around the first matched term (matches Web `extractSearchExcerpt`).
 */
fun extractSearchExcerpt(markdown: String, query: String, maxChars: Int = 88): String? {
    val terms = splitSearchTerms(query)
    if (terms.isEmpty() || markdown.isBlank()) return null
    val cleanedLines = markdown.split('\n').map(::stripLine).filter(String::isNotEmpty)
    if (cleanedLines.isEmpty()) return null
    val bodyText = (if (cleanedLines.size > 1) cleanedLines.drop(1) else cleanedLines).joinToString(" ")
    if (bodyText.isEmpty()) return null
    val lower = bodyText.lowercase()
    val hitTerm = terms.firstOrNull { lower.contains(it) } ?: return null
    val hitIdx = lower.indexOf(hitTerm)
    if (hitIdx < 0) return null
    if (bodyText.length <= maxChars) return bodyText
    val lead = ((maxChars - hitTerm.length).coerceAtLeast(16)) / 3
    val start = (hitIdx - lead).coerceAtLeast(0).coerceAtMost((bodyText.length - maxChars).coerceAtLeast(0))
    val end = (start + maxChars).coerceAtMost(bodyText.length)
    val prefix = if (start > 0) "…" else ""
    val suffix = if (end < bodyText.length) "…" else ""
    return prefix + bodyText.substring(start, end).trim() + suffix
}

/**
 * Finds and merges all non-overlapping `[start, endExclusive)` hit ranges of [query] terms in [text].
 */
fun searchHitRanges(text: String, query: String): List<Pair<Int, Int>> {
    val terms = splitSearchTerms(query)
    if (terms.isEmpty() || text.isEmpty()) return emptyList()
    val lower = text.lowercase()
    val raw = mutableListOf<Pair<Int, Int>>()
    for (term in terms) {
        var cursor = 0
        while (cursor < lower.length) {
            val idx = lower.indexOf(term, cursor)
            if (idx < 0) break
            raw += idx to (idx + term.length).coerceAtMost(text.length)
            cursor = idx + term.length.coerceAtLeast(1)
        }
    }
    if (raw.isEmpty()) return emptyList()
    raw.sortWith(compareBy<Pair<Int, Int>> { it.first }.thenBy { it.second })
    val merged = mutableListOf<Pair<Int, Int>>()
    for (range in raw) {
        val last = merged.lastOrNull()
        if (last != null && range.first <= last.second) {
            merged[merged.lastIndex] = last.first to maxOf(last.second, range.second)
        } else {
            merged += range
        }
    }
    return merged
}
