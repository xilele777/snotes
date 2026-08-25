-- Bug 2：软删除 tombstone。
-- 物理删除不再立刻 DELETE，而是把 invalid 标为 2（墓碑），递增 prop_version/update_time，
-- 让 pull 仍能返回该行，客户端据此删掉本地副本。正文与图片在置墓碑时即回收，
-- note 表的墓碑行保留一段时间后由清理任务真正 DELETE（见 worker/routes/trash.ts）。
-- invalid 原为 INTEGER，取值 0/1/2 都在 INTEGER 内，无需改列定义；此迁移仅加一个
-- 部分索引，供清理任务快速找到可回收的旧墓碑。
CREATE INDEX IF NOT EXISTS idx_note_tombstone ON note(update_time) WHERE invalid = 2;
