package io.github.xilele777.snotes.core.database

import androidx.paging.PagingSource
import androidx.room.*
import kotlinx.coroutines.flow.Flow

@Dao
interface NotesDao {
    @Query("SELECT * FROM notes WHERE invalid = 0 AND (:query = '' OR instr(lower(title), lower(:query)) > 0) ORDER BY update_time DESC LIMIT 50") fun selectNotes(query: String): List<NoteEntity>
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
    @Query("SELECT * FROM notes WHERE invalid = :invalid AND (:starOnly = 0 OR star = 1) AND (:groupId IS NULL OR group_id = :groupId) AND (:query = '' OR instr(lower(title), lower(:query)) > 0 OR instr(lower(summary), lower(:query)) > 0 OR EXISTS (SELECT 1 FROM bodies WHERE note_id = notes.id AND instr(lower(markdown), lower(:query)) > 0)) ORDER BY top DESC, update_time DESC, id ASC")
    fun page(query: String, invalid: Int, starOnly: Boolean, groupId: String?): PagingSource<Int, NoteEntity>
    @Query("SELECT COUNT(*) FROM notes WHERE invalid = 0 AND NOT EXISTS (SELECT 1 FROM bodies WHERE note_id = notes.id)")
    fun missingBodyCount(): Flow<Int>
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
