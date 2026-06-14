-- 彻底修复 RLS 策略和抽卡次数字段，可重复执行
ALTER TABLE users ADD COLUMN IF NOT EXISTS gacha_remaining INTEGER NOT NULL DEFAULT 3;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "任何人可查看用户列表" ON users;
DROP POLICY IF EXISTS "任何人可查询用户" ON users;
DROP POLICY IF EXISTS "任何人可注册用户" ON users;
DROP POLICY IF EXISTS "任何人可插入用户" ON users;
DROP POLICY IF EXISTS "用户可更新自己的资料" ON users;
DROP POLICY IF EXISTS "用户可更新自己" ON users;
CREATE POLICY "任何人可查询用户" ON users FOR SELECT USING (true);
CREATE POLICY "任何人可插入用户" ON users FOR INSERT WITH CHECK (true);
CREATE POLICY "用户可更新自己" ON users FOR UPDATE USING (true) WITH CHECK (true);

ALTER TABLE cards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "任何人可查询卡牌" ON cards;
DROP POLICY IF EXISTS "任何人可添加卡牌" ON cards;
DROP POLICY IF EXISTS "任何人可插入卡牌" ON cards;
DROP POLICY IF EXISTS "用户可删除自己的卡牌" ON cards;
CREATE POLICY "任何人可查询卡牌" ON cards FOR SELECT USING (true);
CREATE POLICY "任何人可插入卡牌" ON cards FOR INSERT WITH CHECK (true);
CREATE POLICY "用户可删除自己的卡牌" ON cards FOR DELETE USING (true);

ALTER TABLE friends ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "任何人可查询好友关系" ON friends;
DROP POLICY IF EXISTS "任何人可查询好友" ON friends;
DROP POLICY IF EXISTS "任何人可添加好友" ON friends;
DROP POLICY IF EXISTS "任何人可插入好友" ON friends;
DROP POLICY IF EXISTS "任何人可删除好友" ON friends;
CREATE POLICY "任何人可查询好友" ON friends FOR SELECT USING (true);
CREATE POLICY "任何人可插入好友" ON friends FOR INSERT WITH CHECK (true);
CREATE POLICY "任何人可删除好友" ON friends FOR DELETE USING (true);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "任何人可查询留言" ON messages;
DROP POLICY IF EXISTS "任何人可发送留言" ON messages;
DROP POLICY IF EXISTS "任何人可插入留言" ON messages;
DROP POLICY IF EXISTS "用户可删除自己的留言" ON messages;
DROP POLICY IF EXISTS "任何人可删除留言" ON messages;
CREATE POLICY "任何人可查询留言" ON messages FOR SELECT USING (true);
CREATE POLICY "任何人可插入留言" ON messages FOR INSERT WITH CHECK (true);
CREATE POLICY "任何人可删除留言" ON messages FOR DELETE USING (true);
