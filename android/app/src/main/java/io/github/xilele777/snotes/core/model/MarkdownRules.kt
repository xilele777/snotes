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
