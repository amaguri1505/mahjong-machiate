-- 既存の2ペアだけを更新。プロフィール・ゲーム記録・進捗・参加コード・権限は変更しない。
begin;
update lab_1.directory set
  id = case id when 1 then 103 when 2 then 102 when 3 then 104 else id end,
  name = case id when 1 then 'ゲスト猫' when 2 then 'ライバル猫' when 3 then '森の猫' else name end
where id in (1, 2, 3);
update lab_2.directory set
  id = case id when 1 then 103 when 2 then 102 when 3 then 104 else id end,
  name = case id when 1 then 'ゲスト猫' when 2 then 'ライバル猫' when 3 then '森の猫' else name end
where id in (1, 2, 3);
commit;
