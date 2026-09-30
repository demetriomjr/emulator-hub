// All checks and writes execute in one Redis script and one hash slot.
export async function compareAndWriteJson(persistence, { checks, writes, instant = Date.now() }) {
 const keys = [...new Set([...checks, ...writes].map(entry => entry.key))]
 const payload = {
  checks: checks.map(({key,...check}) => ({...check,index:keys.indexOf(key)+1})),
  writes: writes.map(({key,...write}) => ({index:keys.indexOf(key)+1,...write})), instant,
 }
 return Number(await persistence.eval(transition, { keys, arguments: [JSON.stringify(payload)] })) === 1
}
const transition = {
 lua: `
local p = cjson.decode(ARGV[1])
for _, check in ipairs(p.checks) do
 local raw = redis.call('GET', KEYS[check.index])
 if check.absent then
  if raw then return 0 end
 elseif check.raw then
  if raw ~= check.raw then return 0 end
 else
  if not raw then return 0 end
  local doc = cjson.decode(raw)
  for field, value in pairs(check.fields) do
   if doc[field] ~= value then return 0 end
  end
  if check.live and (not doc.expiresAt or doc.expiresAt <= p.instant) then return 0 end
 end
end
for _, write in ipairs(p.writes) do
 local kind = redis.call('TYPE', KEYS[write.index]).ok
 local expected = (write.kind == 'sadd' or write.kind == 'srem') and 'set' or ((write.kind == 'zadd' or write.kind == 'zrem') and 'zset' or nil)
 if expected and kind ~= 'none' and kind ~= expected then return redis.error_reply('Invalid transaction index type') end
end
for _, write in ipairs(p.writes) do
 if write.kind == 'sadd' then redis.call('SADD', KEYS[write.index], write.value)
 elseif write.kind == 'srem' then redis.call('SREM', KEYS[write.index], write.value)
 elseif write.kind == 'zrem' then redis.call('ZREM', KEYS[write.index], write.value)
 elseif write.kind == 'zadd' then redis.call('ZADD', KEYS[write.index], write.score, write.value)
 elseif write.value == cjson.null then redis.call('DEL', KEYS[write.index])
 else redis.call('SET', KEYS[write.index], write.value) end
end
return 1`,
 async memory({ keys, arguments: args, get, set, delete: remove, addToSet, removeFromSet, removeFromSortedSet, addToSortedSet }) {
  const p = JSON.parse(args[0])
  for(const check of p.checks) {
   const raw = await get(keys[check.index-1])
   if(check.absent) { if(raw !== null) return 0; continue }
   if(check.raw !== undefined) { if(raw !== check.raw) return 0; continue }
   if(raw === null) return 0
   const doc = JSON.parse(raw)
   if(Object.entries(check.fields).some(([field,value]) => doc[field] !== value)) return 0
   if(check.live && !(doc.expiresAt > p.instant)) return 0
  }
  for(const write of p.writes) {
   if(write.kind === 'sadd') await addToSet(keys[write.index-1], write.value)
   else if(write.kind === 'srem') await removeFromSet(keys[write.index-1], write.value)
   else if(write.kind === 'zrem') await removeFromSortedSet(keys[write.index-1], write.value)
   else if(write.kind === 'zadd') await addToSortedSet(keys[write.index-1], write.value, write.score)
   else if(write.value === null) await remove(keys[write.index-1]); else await set(keys[write.index-1],write.value)
  }
  return 1
 },
}
