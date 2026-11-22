package io.github.xilele777.snotes.core.database

import androidx.paging.PagingSource
import androidx.room.*
import io.github.xilele777.snotes.core.model.sqlSearchTerms
import kotlinx.coroutines.flow.Flow

// Mirror Web's home-feed rules: a note override wins over its active group's default.
private const val HIDDEN_FROM_HOME = "COALESCE(notes.home_hidden, (SELECT home_hidden FROM groups WHERE id = notes.group_id AND invalid = 0), 0) = 1"
private const val NOTE_SCOPE = "invalid = :invalid AND (:starOnly = 0 OR star = 1) AND (:groupId IS NULL OR group_id = :groupId) " +
    "AND (:homeOnly = 0 OR (NOT ($HIDDEN_FROM_HOME) AND notes.id NOT IN (SELECT tocs.note_id FROM tocs JOIN knowledge_bases ON knowledge_bases.id = tocs.knowledge_base_id WHERE tocs.note_id IS NOT NULL AND knowledge_bases.invalid = 0))) " +
    "AND (:hiddenOnly = 0 OR ($HIDDEN_FROM_HOME))"

private const val TERM_1 = "(:t1 = '' OR instr(lower(notes.title), :t1) > 0 OR instr(lower(notes.summary), :t1) > 0 OR EXISTS (SELECT 1 FROM bodies WHERE bodies.note_id = notes.id AND instr(lower(bodies.markdown), :t1) > 0))"
private const val TERM_2 = "(:t2 = '' OR instr(lower(notes.title), :t2) > 0 OR instr(lower(notes.summary), :t2) > 0 OR EXISTS (SELECT 1 FROM bodies WHERE bodies.note_id = notes.id AND instr(lower(bodies.markdown), :t2) > 0))"
private const val TERM_3 = "(:t3 = '' OR instr(lower(notes.title), :t3) > 0 OR instr(lower(notes.summary), :t3) > 0 OR EXISTS (SELECT 1 FROM bodies WHERE bodies.note_id = notes.id AND instr(lower(bodies.markdown), :t3) > 0))"
private const val TERM_4 = "(:t4 = '' OR instr(lower(notes.title), :t4) > 0 OR instr(lower(notes.summary), :t4) > 0 OR EXISTS (SELECT 1 FROM bodies WHERE bodies.note_id = notes.id AND instr(lower(bodies.markdown), :t4) > 0))"
private const val NOTE_TERMS_SEARCH = "($TERM_1 AND $TERM_2 AND $TERM_3 AND $TERM_4)"
private const val TITLE_HIT_RANK = "CASE WHEN :t1 != '' AND instr(lower(notes.title), :t1) > 0 THEN 0 ELSE 1 END"

data class NoteSummaryRow(
    val id: String,
    val title: String,
    val thumbnail: String?,
    val invalid: Int,
    val hasBody: Boolean,
)

@Dao
interface NotesDao {
    @Query("SELECT notes.id AS id, notes.title AS title, notes.thumbnail AS thumbnail, notes.invalid AS invalid, EXISTS(SELECT 1 FROM bodies WHERE bodies.note_id = notes.id) AS hasBody FROM notes WHERE notes.id IN (:ids)")
    fun noteSummaries(ids: List<String>): List<NoteSummaryRow>
    @Query("SELECT COUNT(*) FROM sync_meta WHERE `key` LIKE 'shared:%'")
    fun pendingSharedImagesCount(): Int

    @Query("SELECT * FROM notes WHERE invalid = 0 AND $NOTE_TERMS_SEARCH ORDER BY $TITLE_HIT_RANK ASC, update_time DESC LIMIT 50")
    fun selectNotesByTerms(t1: String, t2: String, t3: String, t4: String): List<NoteEntity>

    fun selectNotes(query: String): List<NoteEntity> {
        val t = sqlSearchTerms(query)
        return selectNotesByTerms(t[0], t[1], t[2], t[3])
    }

    @Query("SELECT DISTINCT notes.id FROM notes JOIN tocs ON tocs.note_id = notes.id WHERE tocs.knowledge_base_id = :bookId AND $NOTE_TERMS_SEARCH")
    fun matchingBookNoteIdsByTerms(bookId: String, t1: String, t2: String, t3: String, t4: String): List<String>

    fun matchingBookNoteIds(bookId: String, query: String): Set<String> {
        val t = sqlSearchTerms(query)
        if (t[0].isEmpty()) return emptySet()
        return matchingBookNoteIdsByTerms(bookId, t[0], t[1], t[2], t[3]).toSet()
    }

    @Query("SELECT * FROM sync_meta WHERE `key` LIKE :prefix || '%'") fun observeMetas(prefix: String): Flow<List<SyncMetaEntity>>
    @Query("SELECT * FROM notes WHERE invalid = 0 ORDER BY top DESC, update_time DESC LIMIT 5") fun recent(): List<NoteEntity>
    @Query("SELECT id FROM notes WHERE (NOT EXISTS (SELECT 1 FROM sync_meta WHERE `key` = 'instance_origin') OR EXISTS (SELECT 1 FROM outbox WHERE entity_id = notes.id AND entity_type = 'note' AND kind = 'create') OR (EXISTS (SELECT 1 FROM sync_meta WHERE `key` = 'books_initialized' AND value = '1') AND NOT EXISTS (SELECT 1 FROM sync_meta WHERE `key` = 'reconcile_books'))) AND NOT EXISTS (SELECT 1 FROM tocs WHERE note_id = notes.id)")
    fun structureIds(): Flow<List<String>>
    @Query("SELECT * FROM knowledge_bases ORDER BY name, id") fun observeBooks(): Flow<List<KnowledgeBaseEntity>>
    @Query("SELECT * FROM tocs") fun observeTocs(): Flow<List<TocEntity>>
    @Query("SELECT * FROM note_states WHERE note_id = :id") fun noteState(id: String): NoteStateEntity?
    @Query("SELECT * FROM images WHERE file_key = :key") fun image(key: String): ImageEntity?
    @Upsert fun putImage(image: ImageEntity)
    @Query("SELECT * FROM notes WHERE id = :id") fun note(id: String): NoteEntity?
    @Query("SELECT * FROM bodies WHERE note_id = :id") fun body(id: String): BodyEntity?

    @Query("SELECT * FROM notes WHERE $NOTE_SCOPE AND $NOTE_TERMS_SEARCH ORDER BY top DESC, $TITLE_HIT_RANK ASC, CASE WHEN :sort = 'title' THEN title END COLLATE NOCASE ASC, CASE WHEN :sort = 'created' THEN create_time ELSE update_time END DESC, id ASC")
    fun pageByTerms(t1: String, t2: String, t3: String, t4: String, invalid: Int, starOnly: Boolean, groupId: String?, homeOnly: Boolean = false, hiddenOnly: Boolean = false, sort: String = "updated"): PagingSource<Int, NoteEntity>

    fun page(query: String, invalid: Int, starOnly: Boolean, groupId: String?, homeOnly: Boolean = false, hiddenOnly: Boolean = false, sort: String = "updated"): PagingSource<Int, NoteEntity> {
        val t = sqlSearchTerms(query)
        return pageByTerms(t[0], t[1], t[2], t[3], invalid, starOnly, groupId, homeOnly, hiddenOnly, sort)
    }

    @Query("SELECT COUNT(*) FROM notes WHERE $NOTE_SCOPE AND $NOTE_TERMS_SEARCH")
    fun filteredCountByTerms(t1: String, t2: String, t3: String, t4: String, invalid: Int, starOnly: Boolean, groupId: String?, homeOnly: Boolean, hiddenOnly: Boolean): Flow<Int>

    fun filteredCount(query: String, invalid: Int, starOnly: Boolean, groupId: String?, homeOnly: Boolean, hiddenOnly: Boolean): Flow<Int> {
        val t = sqlSearchTerms(query)
        return filteredCountByTerms(t[0], t[1], t[2], t[3], invalid, starOnly, groupId, homeOnly, hiddenOnly)
    }
    @Query("SELECT COUNT(*) FROM notes WHERE $NOTE_SCOPE AND NOT EXISTS (SELECT 1 FROM bodies WHERE note_id = notes.id)")
    fun filteredMissingBodies(invalid: Int, starOnly: Boolean, groupId: String?, homeOnly: Boolean, hiddenOnly: Boolean): Flow<Int>
    @Query("SELECT COUNT(*) FROM notes WHERE invalid = 0 AND NOT EXISTS (SELECT 1 FROM bodies WHERE note_id = notes.id)")
    fun missingBodyCount(): Flow<Int>
    @Query("SELECT COUNT(*) FROM notes WHERE invalid = 0")
    fun activeNotesCount(): Flow<Int>
    @Query("SELECT COUNT(*) FROM knowledge_bases WHERE invalid = 0")
    fun activeBooksCount(): Flow<Int>
    @Query("SELECT * FROM groups WHERE invalid = 0 ORDER BY sort, name, id") fun groups(): Flow<List<GroupEntity>>
    @Query("SELECT * FROM groups WHERE id = :id") fun group(id: String): GroupEntity?
    @Upsert fun putNote(note: NoteEntity)
    @Upsert fun putBody(body: BodyEntity)
    @Upsert fun putGroup(group: GroupEntity)
    @Query("SELECT * FROM outbox WHERE entity_type = :type AND entity_id = :id AND kind = :kind")
    fun task(type: String, id: String, kind: String): TaskEntity?
    @Upsert fun putTask(task: TaskEntity): Long
    @Query("DELETE FROM outbox WHERE entity_type = :type AND entity_id = :id AND kind = :kind") fun deleteTask(type: String, id: String, kind: String)
    @Query("SELECT * FROM outbox ORDER BY id") fun tasks(): List<TaskEntity>
    @Query("SELECT COUNT(*) FROM outbox") fun pendingCount(): Flow<Int>
    @Query("SELECT * FROM outbox WHERE failed = 1 ORDER BY id") fun failedTasks(): Flow<List<TaskEntity>>
    @Insert fun putHistory(history: HistoryEntity)
    @Query("SELECT * FROM history WHERE note_id = :id ORDER BY id DESC") fun history(id: String): List<HistoryEntity>
    @Query("DELETE FROM history WHERE note_id = :id AND (time < :cutoff OR id NOT IN (SELECT id FROM history WHERE note_id = :id ORDER BY time DESC, id DESC LIMIT 20))")
    fun pruneHistory(id: String, cutoff: Long)
    @Upsert fun putDraft(draft: DraftEntity)
    @Query("SELECT * FROM drafts") fun drafts(): List<DraftEntity>
    @Query("DELETE FROM drafts WHERE note_id = :noteId AND session_id = :sessionId AND revision <= :revision")
    fun clearDraft(noteId: String, sessionId: String, revision: Long)
    @Query("SELECT revision FROM editor_receipts WHERE note_id = :noteId AND session_id = :sessionId")
    fun receipt(noteId: String, sessionId: String): Long?
    @Upsert fun putReceipt(receipt: ReceiptEntity)
    @Upsert fun putMeta(meta: SyncMetaEntity)
    @Query("SELECT value FROM sync_meta WHERE `key` = :key") fun meta(key: String): String?
    @Query("DELETE FROM sync_meta WHERE `key` = :key") fun deleteMeta(key: String)
    @Query("SELECT * FROM sync_meta WHERE `key` LIKE :prefix || '%'") fun metas(prefix: String): List<SyncMetaEntity>
    @Query("SELECT * FROM notes") fun allNotes(): List<NoteEntity>
    @Query("SELECT * FROM bodies") fun allBodies(): List<BodyEntity>
    @Query("SELECT * FROM groups") fun allGroups(): List<GroupEntity>
    @Query("DELETE FROM notes WHERE id = :id") fun deleteNote(id: String)
    @Query("DELETE FROM groups WHERE id = :id") fun deleteGroup(id: String)
    @Query("SELECT * FROM outbox WHERE id = :id") fun taskById(id: Long): TaskEntity?
    @Query("DELETE FROM outbox WHERE id = :id AND seq = :seq") fun consumeTask(id: Long, seq: Long)
    @Query("DELETE FROM outbox WHERE entity_type = :type AND entity_id = :id") fun deleteTasks(type: String, id: String)
    @Upsert fun putBook(book: KnowledgeBaseEntity)
    @Query("SELECT * FROM knowledge_bases") fun books(): List<KnowledgeBaseEntity>
    @Query("DELETE FROM knowledge_bases WHERE id = :id") fun deleteBook(id: String)
    @Upsert fun putToc(node: TocEntity)
    @Query("DELETE FROM tocs WHERE knowledge_base_id = :id") fun clearToc(id: String)
    @Query("SELECT * FROM tocs WHERE knowledge_base_id = :id") fun toc(id: String): List<TocEntity>
    @Upsert fun putNoteState(state: NoteStateEntity)
}

@Database(entities = [NoteEntity::class, BodyEntity::class, GroupEntity::class, TaskEntity::class,
    SyncMetaEntity::class, HistoryEntity::class, DraftEntity::class, ReceiptEntity::class,
    KnowledgeBaseEntity::class, TocEntity::class, NoteStateEntity::class, ImageEntity::class], version = 1, exportSchema = true)
abstract class NotesDatabase : RoomDatabase() { abstract fun notes(): NotesDao }
