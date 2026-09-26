import assert from 'node:assert/strict'
import test from 'node:test'
import { availablePlayerOriginSlot, canReachPlayerOrigin, findReachablePlayerOriginSlot, findTrustedPlayerFrame, parsePlayerOriginPorts, playerOriginForSlot } from './player-origin-topology.mjs'

test('configured player ports select nine origins independent of page query or debug mode', () => {
  const ports = '8444,8445,8446,8447,8448,8449,8450,8451,8452'
  assert.deepEqual(parsePlayerOriginPorts(new URL('https://hub.example.com/'), ports), [8444, 8445, 8446, 8447, 8448, 8449, 8450, 8451, 8452])
  assert.deepEqual(parsePlayerOriginPorts(new URL('https://hub.example.com/?anything=1'), ports), [8444, 8445, 8446, 8447, 8448, 8449, 8450, 8451, 8452])
  assert.deepEqual(parsePlayerOriginPorts(new URL('https://hub.example.com:8443/'), ports), [8444, 8445, 8446, 8447, 8448, 8449, 8450, 8451, 8452])
  assert.deepEqual(parsePlayerOriginPorts(new URL('https://hub.example.com/'), ''), [])
  assert.deepEqual(parsePlayerOriginPorts(new URL('file:///app/index.html'), ports), [])
  assert.deepEqual(parsePlayerOriginPorts(new URL('http://hub.example.com/'), ports), [])
  assert.throws(() => parsePlayerOriginPorts(new URL('https://hub.example.com/'), '443,8445,8446,8447,8448,8449,8450,8451,8452'))
  assert.throws(() => parsePlayerOriginPorts(new URL('https://hub.example.com/'), '8444,8444,8446,8447,8448,8449,8450,8451,8452'))
  assert.throws(() => parsePlayerOriginPorts(new URL('https://hub.example.com/'), '8444,8445'))
})

test('players get stable distinct origins while free slots can be reused', () => {
  const hub = new URL('http://localhost:5174/')
  const ports = parsePlayerOriginPorts(hub, '5175,5176,5177,5178,5179,5180,5181,5182,5183')
  assert.equal(playerOriginForSlot(hub, 0, ports), 'http://localhost:5175')
  assert.equal(playerOriginForSlot(hub, 5, ports), 'http://localhost:5180')
  assert.equal(availablePlayerOriginSlot([{ playerOriginSlot: 0 }, { playerOriginSlot: 2 }]), 1)
  assert.equal(availablePlayerOriginSlot(Array.from({ length: 9 }, (_, playerOriginSlot) => ({ playerOriginSlot }))), null)
})

test('unreachable player port falls back without sending device cookies', async () => {
  let request
  assert.equal(await canReachPlayerOrigin('https://hub.example.com:8444', { fetcher: async (url, options) => { request = { url, options }; return {} } }), true)
  assert.equal(request.url, 'https://hub.example.com:8444/player.html')
  assert.equal(request.options.method, 'HEAD')
  assert.equal(request.options.credentials, 'omit')
  assert.equal(await canReachPlayerOrigin('https://hub.example.com:8444', { fetcher: async () => { throw new Error('port unavailable') } }), false)
})

test('launch selects an available reachable port and falls back when none respond', async () => {
  const hub = new URL('https://hub.example.com/')
  const ports = [8444, 8445, 8446, 8447, 8448, 8449, 8450, 8451, 8452]
  const sessions = [{ playerOriginSlot: 0 }, { playerOriginSlot: 2 }]
  assert.equal(await findReachablePlayerOriginSlot(sessions, hub, ports, origin => origin.endsWith(':8447')), 3)
  assert.equal(await findReachablePlayerOriginSlot(sessions, hub, ports, () => false), null)
})

test('trusted player message requires the exact source and its configured origin', () => {
  const source = {}
  const otherSource = {}
  const frame = { src: 'http://localhost:5175/player.html', contentWindow: source }
  const otherFrame = { src: 'http://localhost:5176/player.html', contentWindow: otherSource }
  assert.equal(findTrustedPlayerFrame({ source, origin: 'http://localhost:5175' }, [frame, otherFrame], 'http://localhost:5174'), frame)
  assert.equal(findTrustedPlayerFrame({ source, origin: 'http://localhost:5176' }, [frame, otherFrame], 'http://localhost:5174'), null)
  assert.equal(findTrustedPlayerFrame({ source: {}, origin: 'http://localhost:5175' }, [frame], 'http://localhost:5174'), null)
  assert.equal(findTrustedPlayerFrame({ source, origin: 'null' }, [{ src: 'file:///app/player.html', contentWindow: source }], 'null')?.contentWindow, source)
})

test('nine players receive distinct stable origin slots and the tenth has none', () => {
  const hub = new URL('https://hub.example.com/')
  const ports = parsePlayerOriginPorts(hub, '8444,8445,8446,8447,8448,8449,8450,8451,8452')
  assert.equal(ports.length, 9)
  assert.equal(playerOriginForSlot(hub, 8, ports), 'https://hub.example.com:8452')
  assert.equal(availablePlayerOriginSlot(Array.from({ length: 8 }, (_, playerOriginSlot) => ({ playerOriginSlot }))), 8)
  assert.equal(availablePlayerOriginSlot(Array.from({ length: 9 }, (_, playerOriginSlot) => ({ playerOriginSlot }))), null)
  assert.throws(() => parsePlayerOriginPorts(hub, '8444,8445,8446,8447,8448,8449'))
  assert.throws(() => parsePlayerOriginPorts(hub, '8444,8445,8446,8447,8448,8449,8450,8451,8451'))
})
