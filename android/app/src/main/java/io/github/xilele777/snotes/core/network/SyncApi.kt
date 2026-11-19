package io.github.xilele777.snotes.core.network

import io.github.xilele777.snotes.core.model.NoteMeta
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.json.JsonObject
import okhttp3.ResponseBody
import okhttp3.MultipartBody
import okhttp3.RequestBody
import retrofit2.Response
import retrofit2.http.*

const val MAX_SAFE_INTEGER = 9_007_199_254_740_991L
fun safeNumber(value: Long) { require(value in 0..MAX_SAFE_INTEGER) { "invalid_server_number" } }
fun safeId(value: String) { require(value.matches(Regex("[A-Za-z0-9_-]{1,128}"))) { "invalid_server_id" } }

@Serializable data class InstanceDto(val epoch: String) {
    init { require(epoch.isNotBlank() && epoch.length <= 256 && epoch.none { it <= ' ' }) }
}
@Serializable data class CheckpointRequest(val since: Long, val checkpoint: String?,
    @SerialName("require_current") val requireCurrent: Boolean = false)
@Serializable data class CheckpointDto(val valid: Boolean)
@Serializable data class PullRequest(val since: Long, val checkpoint: String?, val cursor: String? = null, val limit: Int = 200)
@Serializable data class GroupDto(@SerialName("group_id") val id: String, val name: String, val ord: Int,
    val color: String?, @SerialName("hide_from_home") val hideFromHome: Int = 0, val invalid: Int,
    @SerialName("update_time") val updateTime: Long) {
    init { safeId(id); safeNumber(updateTime); require(ord >= 0 && invalid in 0..1 && hideFromHome in 0..1) }
}
@Serializable data class PullDto(val notes: List<NoteMeta>, val groups: List<GroupDto>,
    @SerialName("server_time") val serverTime: Long, @SerialName("next_cursor") val nextCursor: String?,
    val checkpoint: String, @SerialName("trash_retention_days") val trashRetentionDays: Int? = null) {
    init { safeNumber(serverTime); require(checkpoint.isNotEmpty() && notes.size <= 500) }
}
@Serializable data class BodiesRequest(val ids: List<String>)
@Serializable data class BodyDto(@SerialName("note_id") val noteId: String, val content: String, val version: Long) {
    init { safeId(noteId); safeNumber(version) }
}
@Serializable data class BodiesDto(val bodies: List<BodyDto>)
@Serializable data class WriteAck(val version: Long? = null, @SerialName("prop_version") val propVersion: Long? = null,
    @SerialName("update_time") val updateTime: Long, val conflicted: Boolean = false,
    @SerialName("previous_content") val previousContent: String? = null, val replayed: Boolean = false) {
    init { version?.let(::safeNumber); propVersion?.let(::safeNumber); safeNumber(updateTime) }
}
@OptIn(ExperimentalSerializationApi::class)
@Serializable data class BooksRequest(val since: Long, val checkpoint: String?, val after: Long = since,
    @EncodeDefault(EncodeDefault.Mode.NEVER) val until: Long? = null, val inventory: Boolean = false,
    @EncodeDefault(EncodeDefault.Mode.NEVER) @SerialName("after_id") val afterId: String? = null)
@Serializable data class BookDto(val id: String, val name: String, val description: String, val icon: String,
    val ord: Int, val invalid: Int, val deleted: Int = 0, @SerialName("meta_version") val metaVersion: Long,
    @SerialName("toc_version") val tocVersion: Long, @SerialName("create_time") val createTime: Long,
    @SerialName("update_time") val updateTime: Long, @SerialName("change_seq") val changeSeq: Long) {
    init { safeId(id); listOf(metaVersion, tocVersion, createTime, updateTime, changeSeq).forEach(::safeNumber)
        require(invalid in 0..1 && deleted in 0..1 && name.isNotBlank() && name.length <= 100 && description.length <= 2000 && icon.length <= 32 && ord in -1_000_000..1_000_000) }
}
@Serializable data class BooksDto(val books: List<BookDto>, val until: Long,
    @SerialName("next_after") val nextAfter: Long?, @SerialName("next_id") val nextId: String? = null, val checkpoint: String) {
    init { safeNumber(until); nextAfter?.let(::safeNumber); require(books.size <= 50 && checkpoint.isNotEmpty()) }
}
@Serializable data class TocNodeDto(val id: String, @SerialName("parent_id") val parentId: String?, val kind: String,
    val ord: Int, @SerialName("note_id") val noteId: String?, val title: String?)
@Serializable data class TocDto(@SerialName("knowledge_base_id") val bookId: String, val version: Long,
    val nodes: List<TocNodeDto>, @SerialName("update_time") val updateTime: Long)
@Serializable data class BookRemoteDto(val book: BookDto, val toc: TocDto,
    @SerialName("note_states") val noteStates: Map<String, String>,
    @SerialName("deleted_note_ids") val deletedNoteIds: List<String> = emptyList())
@Serializable data class ImageUploadDto(@SerialName("file_key") val fileKey: String, val url: String, val size: Long, val mime: String)
@Serializable data class BookAckDto(@SerialName("meta_version") val metaVersion: Long, @SerialName("toc_version") val tocVersion: Long, @SerialName("update_time") val updateTime: Long) {
    init { listOf(metaVersion, tocVersion, updateTime).forEach(::safeNumber) }
}

/** Mutations always require an epoch argument; reads never silently substitute /health for authentication. */
interface SyncApi {
    @POST("api/notes/opens") suspend fun opens(@Header("X-Snotes-Epoch") epoch: String, @Body request: io.github.xilele777.snotes.core.data.OpenRequest): Response<io.github.xilele777.snotes.core.data.OpenResponse>
    @POST("api/knowledge-bases") suspend fun createBook(@Header("X-Snotes-Epoch") epoch: String, @Body payload: JsonObject): Response<BookAckDto>
    @PATCH("api/knowledge-bases/{id}") suspend fun patchBook(@Path("id") id: String, @Header("X-Snotes-Epoch") epoch: String, @Body payload: JsonObject): Response<BookAckDto>
    @PUT("api/knowledge-bases/{id}/toc") suspend fun putToc(@Path("id") id: String, @Header("X-Snotes-Epoch") epoch: String, @Body payload: JsonObject): Response<BookAckDto>
    @POST("api/knowledge-bases/{id}/delete") suspend fun deleteBook(@Path("id") id: String, @Header("X-Snotes-Epoch") epoch: String, @Body payload: JsonObject): Response<BookRemoteDto>
    @Multipart @POST("api/images/upload") suspend fun uploadImage(@Header("X-Snotes-Epoch") epoch: String,
        @Part file: MultipartBody.Part, @Part("note_id") noteId: RequestBody): Response<ImageUploadDto>
    @GET("api/sync/instance") suspend fun instance(): Response<InstanceDto>
    @POST("api/sync/checkpoint") suspend fun checkpoint(@Body request: CheckpointRequest): Response<CheckpointDto>
    @POST("api/knowledge-bases/sync/checkpoint") suspend fun booksCheckpoint(@Body request: CheckpointRequest): Response<CheckpointDto>
    @POST("api/sync/pull") suspend fun pull(@Body request: PullRequest): Response<PullDto>
    @POST("api/sync/bodies") suspend fun bodies(@Body request: BodiesRequest): Response<BodiesDto>
    @POST("api/knowledge-bases/sync/pull") suspend fun books(@Body request: BooksRequest): Response<BooksDto>
    @GET("api/knowledge-bases/{id}/toc") suspend fun toc(@Path("id") id: String): Response<BookRemoteDto>
    @POST("api/notes") suspend fun create(@Header("X-Snotes-Epoch") epoch: String, @Body payload: JsonObject): Response<WriteAck>
    @PATCH("api/notes/{id}") suspend fun patch(@Path("id") id: String, @Header("X-Snotes-Epoch") epoch: String, @Body payload: JsonObject): Response<WriteAck>
    @POST("api/notes/{id}/trash") suspend fun trash(@Path("id") id: String, @Header("X-Snotes-Epoch") epoch: String, @Body payload: JsonObject): Response<WriteAck>
    @POST("api/notes/{id}/recover") suspend fun recover(@Path("id") id: String, @Header("X-Snotes-Epoch") epoch: String, @Body payload: JsonObject): Response<WriteAck>
    @POST("api/groups") suspend fun createGroup(@Header("X-Snotes-Epoch") epoch: String, @Body payload: JsonObject): Response<WriteAck>
    @PATCH("api/groups/{id}") suspend fun patchGroup(@Path("id") id: String, @Header("X-Snotes-Epoch") epoch: String, @Body payload: JsonObject): Response<WriteAck>
    @DELETE("api/groups/{id}") suspend fun deleteGroup(@Path("id") id: String, @Header("X-Snotes-Epoch") epoch: String): Response<WriteAck>
    @Streaming @GET("api/images/{key}") suspend fun image(@Path("key") key: String): Response<ResponseBody>
}
