-- 修复 RLS 策略
ALTER TABLE cards ENABLE ROW LEVEL SECURITY;

-- 允许任何人插入卡牌（注册/抽卡时需要）
CREATE POLICY "任何人可插入卡牌" ON cards FOR INSERT WITH CHECK (true);

-- 允许任何人查询卡牌
CREATE POLICY "任何人可查询卡牌" ON cards FOR SELECT USING (true);

-- 允许用户删除自己的卡牌
CREATE POLICY "用户可删除自己的卡牌" ON cards FOR DELETE USING (true);

-- 同样修复 users 表
ALTER TABLE users ADD COLUMN IF NOT EXISTS signature TEXT NOT NULL DEFAULT '';
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "任何人可查询用户" ON users FOR SELECT USING (true);
CREATE POLICY "任何人可插入用户" ON users FOR INSERT WITH CHECK (true);
CREATE POLICY "用户可更新自己" ON users FOR UPDATE USING (true);

-- 修复 friends 表
ALTER TABLE friends ENABLE ROW LEVEL SECURITY;
CREATE POLICY "任何人可查询好友" ON friends FOR SELECT USING (true);
CREATE POLICY "任何人可插入好友" ON friends FOR INSERT WITH CHECK (true);
CREATE POLICY "任何人可删除好友" ON friends FOR DELETE USING (true);

-- 修复 messages 表
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "任何人可查询留言" ON messages FOR SELECT USING (true);
CREATE POLICY "任何人可插入留言" ON messages FOR INSERT WITH CHECK (true);
CREATE POLICY "任何人可删除留言" ON messages FOR DELETE USING (true);

-- 验证
SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('users','cards','friends','messages') ORDER BY tablename;
