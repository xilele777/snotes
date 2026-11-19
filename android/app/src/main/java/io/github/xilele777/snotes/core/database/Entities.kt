package io.github.xilele777.snotes.core.database

import androidx.room.*

@Entity(tableName = "notes", indices = [Index(value = ["invalid", "top", "update_time"]), Index("group_id"), Index("star")])
data class NoteEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "group_id") val groupId: String? = null,
    val title: String = "", val summary: String = "", val thumbnail: String? = null,
    val version: Long = 0,
    @ColumnInfo(name = "prop_version") val propVersion: Long = 0,
    @ColumnInfo(name = "body_version") val bodyVersion: Long = 0,
    val star: Int = 0, val top: Int = 0,
    @ColumnInfo(name = "skin_color") val skinColor: String? = null,
    @ColumnInfo(name = "home_hidden") val homeHidden: Int? = null,
    val invalid: Int = 0,
    @ColumnInfo(name = "create_time") val createTime: Long,
    @ColumnInfo(name = "update_time") val updateTime: Long,
    val dirty: String = "both",
)

@Entity(tableName = "bodies", foreignKeys = [ForeignKey(entity = NoteEntity::class, parentColumns = ["id"], childColumns = ["note_id"], onDelete = ForeignKey.CASCADE)])
data class BodyEntity(@PrimaryKey @ColumnInfo(name = "note_id") val noteId: String, val markdown: String)

@Entity(tableName = "groups")
data class GroupEntity(@PrimaryKey val id: String, val name: String, val sort: Int = 0, val color: String? = null,
    @ColumnInfo(name = "home_hidden") val homeHidden: Int = 0, val invalid: Int = 0, val dirty: Boolean = true)

@Entity(tableName = "outbox", indices = [Index(value = ["entity_type", "entity_id", "kind"], unique = true)])
data class TaskEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "entity_type") val entityType: String = "note",
    @ColumnInfo(name = "entity_id") val entityId: String,
    val kind: String, val payload: String, val seq: Long = 0,
    val retry: Int = 0, @ColumnInfo(name = "next_at") val nextAt: Long = 0, val failed: Int = 0,
    @ColumnInfo(name = "last_error") val lastError: String? = null,
    @ColumnInfo(name = "failed_at") val failedAt: Long? = null,
)

@Entity(tableName = "sync_meta")
data class SyncMetaEntity(@PrimaryKey val key: String, val value: String)

@Entity(tableName = "history", indices = [Index("note_id")], foreignKeys = [ForeignKey(entity = NoteEntity::class, parentColumns = ["id"], childColumns = ["note_id"], onDelete = ForeignKey.CASCADE)])
data class HistoryEntity(@PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "note_id") val noteId: String, val markdown: String, val time: Long, val source: String = "local")

@Entity(tableName = "drafts", primaryKeys = ["note_id", "session_id"])
data class DraftEntity(@ColumnInfo(name = "note_id") val noteId: String,
    @ColumnInfo(name = "session_id") val sessionId: String, val revision: Long, val baseline: String,
    val markdown: String, val composing: Boolean, val error: String? = null)

// Receipts deliberately survive journal cleanup and are keyed by BOTH note and session.
@Entity(tableName = "editor_receipts", primaryKeys = ["note_id", "session_id"])
data class ReceiptEntity(@ColumnInfo(name = "note_id") val noteId: String,
    @ColumnInfo(name = "session_id") val sessionId: String, val revision: Long)

@Entity(tableName = "knowledge_bases")
data class KnowledgeBaseEntity(@PrimaryKey val id: String, val name: String, val description: String = "",
    @ColumnInfo(name = "toc_version") val tocVersion: Long = 0, val invalid: Int = 0)

@Entity(tableName = "tocs", primaryKeys = ["knowledge_base_id", "id"])
data class TocEntity(@ColumnInfo(name = "knowledge_base_id") val knowledgeBaseId: String, val id: String,
    @ColumnInfo(name = "parent_id") val parentId: String? = null, @ColumnInfo(name = "note_id") val noteId: String? = null,
    val name: String, val sort: Int = 0)

@Entity(tableName = "note_states")
data class NoteStateEntity(@PrimaryKey @ColumnInfo(name = "note_id") val noteId: String, val state: String)

@Entity(tableName = "images")
data class ImageEntity(@PrimaryKey @ColumnInfo(name = "file_key") val fileKey: String,
    val mime: String, val size: Long, val status: String)
