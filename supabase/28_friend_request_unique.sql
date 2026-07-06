-- 28: заявки в друзья — защита от дублей на уровне базы (v1.122.0)

-- 1) Чистим существующие дубли: для каждой пары пользователей оставляем
--    одну активную запись (pending/accepted), остальные удаляем.
delete from friend_requests fr
using friend_requests fr2
where fr.status in ('pending','accepted')
  and fr2.status in ('pending','accepted')
  and least(fr.from_user, fr.to_user) = least(fr2.from_user, fr2.to_user)
  and greatest(fr.from_user, fr.to_user) = greatest(fr2.from_user, fr2.to_user)
  and fr.ctid > fr2.ctid;

-- 2) Уникальность пары (в любом направлении) среди активных записей.
--    Отклонённые заявки не мешают отправить новую.
create unique index if not exists friend_requests_pair_active_uniq
  on friend_requests ((least(from_user, to_user)), (greatest(from_user, to_user)))
  where status in ('pending','accepted');

-- 3) Нельзя отправить заявку самому себе.
alter table friend_requests drop constraint if exists friend_requests_not_self;
alter table friend_requests add constraint friend_requests_not_self check (from_user <> to_user);
