-- 首页信息流可见性：默认所有笔记都进「全部笔记」，但允许分组设默认、笔记单独覆盖。
-- note.home_hidden 三态：0 = 强制显示，1 = 强制隐藏，NULL = 跟随所在分组的 hide_from_home。
-- 用 NULL 表示「跟随」而不是在建笔记时把分组默认值复制过来：分组设置改动后，
-- 组内没有单独设置过的笔记要立刻跟着变，而不是停留在入组那一刻的旧默认值。
ALTER TABLE note ADD COLUMN home_hidden INTEGER;

-- 分组级默认：1 = 加进这个分组的笔记默认不出现在首页信息流。
ALTER TABLE note_group ADD COLUMN hide_from_home INTEGER NOT NULL DEFAULT 0;
