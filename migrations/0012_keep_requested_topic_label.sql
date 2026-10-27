INSERT OR IGNORE INTO approved_topics(user_id,topic,created_at) SELECT user_id,'shark species',created_at FROM approved_topics WHERE lower(topic)='marine biology focused on shark species';
UPDATE users SET profile=json_set(profile,'$.interests',json((SELECT json_group_array(CASE WHEN lower(value)='marine biology focused on shark species' THEN 'shark species' ELSE value END) FROM json_each(users.profile,'$.interests')))) WHERE EXISTS(SELECT 1 FROM json_each(users.profile,'$.interests') WHERE lower(value)='marine biology focused on shark species');
UPDATE questions SET data=json_set(data,'$.topic','shark species') WHERE lower(json_extract(data,'$.topic'))='marine biology focused on shark species';
DELETE FROM approved_topics WHERE lower(topic)='marine biology focused on shark species';
